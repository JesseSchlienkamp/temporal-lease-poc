import {
  CancellationScope,
  condition,
  defineQuery,
  defineSignal,
  log,
  proxyActivities,
  setHandler,
  workflowInfo,
} from '@temporalio/workflow';
import type * as activities from '../activities';
import type {
  ContractSigned,
  LeadInput,
  OnboardingOptions,
  OnboardingState,
  OnboardingStatus,
  QuoteDecision,
} from '../shared/types';

// --- Activity proxies --------------------------------------------------------------------------
// Local database work: fast, should practically never fail.
const local = proxyActivities<typeof activities>({
  startToCloseTimeout: '10 seconds',
  retry: { maximumAttempts: 5 },
});

// Calls to external systems: these are the flaky ones. Temporal retries them with exponential
// backoff (1s, 2s, 4s, ... capped at 30s). Non-retryable failures (e.g. HTTP 404 for an unknown
// vehicle model) skip the retries and fail immediately.
const external = proxyActivities<typeof activities>({
  startToCloseTimeout: '10 seconds', // a hanging call is abandoned after 10s and retried
  retry: {
    initialInterval: '1 second',
    backoffCoefficient: 2,
    maximumInterval: '30 seconds',
    maximumAttempts: 10,
    nonRetryableErrorTypes: ['ExternalServiceRejected'],
  },
});

// --- Signals & queries -------------------------------------------------------------------------
export const quoteDecisionSignal = defineSignal<[QuoteDecision]>('quoteDecision');
export const contractSignedSignal = defineSignal<[ContractSigned]>('contractSigned');
export const getStateQuery = defineQuery<OnboardingState>('getState');

/**
 * Lead -> qualification -> credit check -> vehicle reservation -> quote -> (customer accepts)
 *      -> contract -> e-signature -> (customer signs) -> active lease
 *
 * The workflow id is used as the lead id.
 */
export async function carLeaseOnboarding(lead: LeadInput, options: OnboardingOptions = {}): Promise<OnboardingState> {
  const leadId = workflowInfo().workflowId;
  const state: OnboardingState = { leadId, status: 'LEAD_RECEIVED', history: [] };
  const compensations: Array<() => Promise<void>> = [];

  let quoteDecision: QuoteDecision | undefined;
  let signature: ContractSigned | undefined;

  setHandler(getStateQuery, () => state);
  setHandler(quoteDecisionSignal, (decision) => {
    quoteDecision ??= decision;
  });
  setHandler(contractSignedSignal, (signed) => {
    signature ??= signed;
  });

  async function setStatus(status: OnboardingStatus, note?: string): Promise<void> {
    state.status = status;
    state.history.push({ status, at: new Date().toISOString(), note });
    log.info(`Lead ${leadId} -> ${status}`, { note });
    await local.updateLeadStatus(leadId, status, note);
  }

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
    const credit = await external.runCreditCheck(leadId, lead);
    state.creditScore = credit.score;
    if (credit.decision === 'REJECTED') {
      await setStatus('CREDIT_REJECTED', `Score ${credit.score}`);
      await external.sendEmail(leadId, lead.email, 'credit-rejected');
      return state;
    }
    await setStatus('CREDIT_APPROVED', `Score ${credit.score}`);

    // 4. Reserve the vehicle (flaky + slow external call)
    const reservation = await external.reserveVehicle(leadId, lead.vehicleModel);
    compensations.unshift(() => external.releaseVehicle(leadId, reservation.reservationId));
    state.reservation = reservation;
    await setStatus('VEHICLE_RESERVED', reservation.vin);

    // 5. Quote
    const quote = await local.createQuote(leadId, lead, reservation, credit);
    state.quote = quote;
    await external.sendEmail(leadId, lead.email, 'quote', { ...quote });
    await setStatus('QUOTE_SENT', `EUR ${quote.monthlyPayment}/month`);

    // 6. Wait (durably: days, weeks...) for the customer to accept the quote
    const decided = await condition(() => quoteDecision !== undefined, options.quoteDecisionTimeout ?? '7 days');
    if (!decided || !quoteDecision!.accepted) {
      await local.updateQuoteStatus(quote.quoteId, decided ? 'DECLINED' : 'EXPIRED');
      await compensate();
      await setStatus(decided ? 'QUOTE_DECLINED' : 'QUOTE_EXPIRED', quoteDecision?.reason);
      return state;
    }

    // 7. Contract + e-signature (flaky external call)
    const draft = await local.createContract(leadId, quote);
    state.contract = await external.requestSignature(leadId, draft.contractId, lead.email);
    await external.sendEmail(leadId, lead.email, 'contract-ready', { signingUrl: state.contract.signingUrl });
    await setStatus('AWAITING_SIGNATURE');

    // 8. Wait for the signature
    const signed = await condition(() => signature !== undefined, options.signatureTimeout ?? '14 days');
    if (!signed) {
      await local.expireContract(leadId, draft.contractId);
      await compensate();
      await setStatus('SIGNATURE_EXPIRED');
      return state;
    }

    // 9. Activate
    await local.activateLease(leadId, draft.contractId, signature!.signedAt);
    await setStatus('ACTIVE', `Signed ${signature!.signedAt}`);
    await external.sendEmail(leadId, lead.email, 'welcome');
    return state;
  } catch (err) {
    // Reached when an activity exhausted its retries or failed non-retryably, or on cancellation.
    await compensate();
    await CancellationScope.nonCancellable(() =>
      setStatus('FAILED', rootCauseMessage(err)),
    );
    throw err;
  }
}

function rootCauseMessage(err: unknown): string {
  let current = err;
  while (current instanceof Error && current.cause instanceof Error) current = current.cause;
  return current instanceof Error ? current.message : String(current);
}
