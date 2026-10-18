import {
  CancellationScope,
  condition,
  defineQuery,
  defineSignal,
  log,
  setHandler,
  startChild,
  workflowInfo,
} from '@temporalio/workflow';
import { signingWorkflowId } from '../shared/ids';
import type {
  LeadInput,
  OnboardingOptions,
  OnboardingState,
  OnboardingStatus,
  QuoteDecision,
} from '../shared/types';
import { external, local } from './activity-proxies';
import { contractSigning } from './contract-signing';
import { createOperatorRecovery, rootCauseMessage } from './operator-recovery';

// --- Signals & queries -------------------------------------------------------------------------
export const quoteDecisionSignal = defineSignal<[QuoteDecision]>('quoteDecision');
export const getStateQuery = defineQuery<OnboardingState>('getState');

/**
 * Lead -> qualification -> credit check -> vehicle reservation -> quote -> (customer accepts)
 *      -> [child: contract -> e-signature -> (customer signs)] -> active lease
 *
 * The workflow id is used as the lead id.
 *
 * External calls are wrapped in `recovery.guard`: when one exhausts its retries, the lead moves to
 * NEEDS_ATTENTION and the workflow waits for an operator (`operatorAction` update: retry | abort).
 */
export async function carLeaseOnboarding(lead: LeadInput, options: OnboardingOptions = {}): Promise<OnboardingState> {
  const leadId = workflowInfo().workflowId;
  const state: OnboardingState = { leadId, status: 'LEAD_RECEIVED', history: [] };
  const compensations: Array<() => Promise<void>> = [];

  let quoteDecision: QuoteDecision | undefined;

  setHandler(getStateQuery, () => state);
  setHandler(quoteDecisionSignal, (decision) => {
    quoteDecision ??= decision;
  });

  async function setStatus(status: OnboardingStatus, note?: string): Promise<void> {
    state.status = status;
    state.history.push({ status, at: new Date().toISOString(), note });
    log.info(`Lead ${leadId} -> ${status}`, { note });
    await local.updateLeadStatus(leadId, status, note);
  }

  let statusBeforeParking: OnboardingStatus = state.status;
  const recovery = createOperatorRecovery({
    async onPark(parked) {
      statusBeforeParking = state.status;
      state.needsAttention = parked;
      await setStatus('NEEDS_ATTENTION', `${parked.step}: ${parked.error}`);
    },
    async onResume(parked, command) {
      state.needsAttention = undefined;
      const note = `Operator ${command.action} at ${parked.step}${command.note ? `: ${command.note}` : ''}`;
      await setStatus(statusBeforeParking, note);
    },
  });

  // Saga: undo side effects in external systems, even when the workflow is being cancelled.
  async function compensate(): Promise<void> {
    await CancellationScope.nonCancellable(async () => {
      for (const undo of compensations) {
        try {
          await undo();
        } catch (err) {
          log.error('Compensation failed', { error: String(err) });
        }
      }
    });
  }

  try {
    // 1. Register the lead
    await local.saveLead(leadId, lead);
    await setStatus('LEAD_RECEIVED');

    // 2. Qualify (business rules only)
    const qualification = await local.qualifyLead(leadId, lead);
    if (!qualification.qualified) {
      await setStatus('DISQUALIFIED', qualification.reason);
      return state;
    }
    await setStatus('QUALIFIED');

    // 3. Credit check (flaky external call)
    const credit = await recovery.guard('runCreditCheck', () => external.runCreditCheck(leadId, lead));
    state.creditScore = credit.score;
    if (credit.decision === 'REJECTED') {
      await setStatus('CREDIT_REJECTED', `Score ${credit.score}`);
      await recovery.guard('sendEmail:credit-rejected', () =>
        external.sendEmail(leadId, lead.email, 'credit-rejected'),
      );
      return state;
    }
    await setStatus('CREDIT_APPROVED', `Score ${credit.score}`);

    // 4. Reserve the vehicle (flaky + slow external call)
    const reservation = await recovery.guard('reserveVehicle', () =>
      external.reserveVehicle(leadId, lead.vehicleModel),
    );
    compensations.unshift(() => external.releaseVehicle(leadId, reservation.reservationId));
    state.reservation = reservation;
    await setStatus('VEHICLE_RESERVED', reservation.vin);

    // 5. Quote
    const quote = await local.createQuote(leadId, lead, reservation, credit);
    state.quote = quote;
    await recovery.guard('sendEmail:quote', () => external.sendEmail(leadId, lead.email, 'quote', { ...quote }));
    await setStatus('QUOTE_SENT', `EUR ${quote.monthlyPayment}/month`);

    // 6. Wait (durably: days, weeks...) for the customer to accept the quote
    const decided = await condition(() => quoteDecision !== undefined, options.quoteDecisionTimeout ?? '7 days');
    if (!decided || !quoteDecision!.accepted) {
      await local.updateQuoteStatus(quote.quoteId, decided ? 'DECLINED' : 'EXPIRED');
      await compensate();
      await setStatus(decided ? 'QUOTE_DECLINED' : 'QUOTE_EXPIRED', quoteDecision?.reason);
      return state;
    }

    // 7. Contract, payment details (agent form if the IBAN is missing or wrong) and e-signature
    //    in a child workflow (see contract-signing.ts)
    const signing = await startChild(contractSigning, {
      workflowId: signingWorkflowId(leadId),
      args: [
        {
          leadId,
          quote,
          signerEmail: lead.email,
          customerName: `${lead.firstName} ${lead.lastName}`,
          iban: lead.iban,
          signatureTimeout: options.signatureTimeout,
        },
      ],
    });
    state.signingWorkflowId = signing.workflowId;
    await setStatus('CONTRACTING', `Signing workflow ${signing.workflowId}`);

    // 8. Wait for the child. If the child is reset, this follows its new run.
    const signed = await signing.result();
    state.contract = signed.contract;
    state.mandate = signed.mandate;
    if (signed.outcome === 'EXPIRED') {
      await compensate();
      await setStatus('SIGNATURE_EXPIRED');
      return state;
    }

    // 9. Activate
    await local.activateLease(leadId, signed.contract.contractId, signed.signedAt);
    await setStatus('ACTIVE', `Signed ${signed.signedAt}`);
    await recovery.guard('sendEmail:welcome', () => external.sendEmail(leadId, lead.email, 'welcome'));
    return state;
  } catch (err) {
    // Reached on non-retryable failures, an operator abort, a failed signing child, or cancellation.
    await compensate();
    await CancellationScope.nonCancellable(() =>
      setStatus('FAILED', rootCauseMessage(err)),
    );
    throw err;
  }
}
