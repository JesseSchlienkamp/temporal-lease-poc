import {
  allHandlersFinished,
  condition,
  defineQuery,
  defineSignal,
  defineUpdate,
  setHandler,
  workflowInfo,
} from '@temporalio/workflow';
import type { Duration } from '@temporalio/common';
import { formatIban, ibanError, normalizeIban } from '../shared/iban';
import { namesMatch } from '../shared/names';
import type {
  Contract,
  ContractSigned,
  OnboardingStatus,
  PaymentDetails,
  PaymentMandate,
  Quote,
} from '../shared/types';
import { external, local } from './activity-proxies';
import { createOperatorRecovery, type ParkedStep } from './operator-recovery';

export interface ContractSigningInput {
  leadId: string;
  quote: Quote;
  signerEmail: string;
  customerName: string;
  /** From the application. Missing or failing verification -> an agent form is opened. */
  iban?: string;
  signatureTimeout?: Duration;
}

export type ContractSigningResult =
  | { outcome: 'SIGNED'; contract: Contract; mandate: PaymentMandate; signedAt: string; signerName?: string }
  | { outcome: 'EXPIRED'; contract: Contract; mandate: PaymentMandate };

export type SigningStage =
  | 'CREATING_CONTRACT'
  | 'VERIFYING_PAYMENT_DETAILS'
  | 'AWAITING_AGENT'
  | 'SENDING_FOR_SIGNATURE'
  | 'AWAITING_SIGNATURE'
  | 'SIGNED'
  | 'EXPIRED';

/** An open work item for a human agent: supply a valid IBAN for the direct-debit mandate. */
export interface AgentForm {
  type: 'COLLECT_IBAN';
  leadId: string;
  customerName: string;
  /** Why the form is (re)opened: missing IBAN, or why the previous value was rejected. */
  reason: string;
  /** Submissions rejected so far. */
  rejectedSubmissions: number;
  openedAt: string;
  prefill: { accountHolder: string; iban?: string };
}

export interface SigningState {
  stage: SigningStage;
  contract?: Contract;
  mandate?: PaymentMandate;
  /** Present while the workflow waits for an agent. */
  agentForm?: AgentForm;
  /** Set while a step has exhausted its retries and waits for an operator. */
  needsAttention?: ParkedStep;
}

export type SubmitPaymentDetailsResult =
  | { accepted: true; mandate: PaymentMandate }
  | { accepted: false; reason: string; rejectedSubmissions: number };

export const contractSignedSignal = defineSignal<[ContractSigned]>('contractSigned');
export const getSigningStateQuery = defineQuery<SigningState>('getSigningState');
/**
 * The agent form's submit. Malformed input is rejected by the validator (nothing is recorded in
 * history, the form stays open). Well-formed input is verified by the workflow; the update returns
 * that verdict, and on rejection the form is reopened with the reason.
 */
export const submitPaymentDetailsUpdate = defineUpdate<SubmitPaymentDetailsResult, [PaymentDetails]>(
  'submitPaymentDetails',
);

/**
 * Child workflow: contract -> payment details (agent form if needed) -> e-signature -> signature.
 *
 * Runs under its own workflow id (see signingWorkflowId), so it can be reset to its first
 * workflow task without touching the parent's history: the credit check and vehicle reservation
 * are not repeated. Every step here is idempotent, so re-running it from the start is safe.
 *
 * Has its own operator recovery: send the `operatorAction` update to this child's workflow id.
 */
export async function contractSigning(input: ContractSigningInput): Promise<ContractSigningResult> {
  const { leadId, quote, signerEmail, customerName } = input;
  const { workflowId } = workflowInfo();
  const state: SigningState = { stage: 'CREATING_CONTRACT' };
  let signature: ContractSigned | undefined;
  let leadStatus: OnboardingStatus = 'CONTRACTING';

  // Agent form submissions: the update handler hands one over and waits for the verdict.
  let submission: { id: number; details: PaymentDetails } | undefined;
  let submissionCount = 0;
  const verdicts = new Map<number, SubmitPaymentDetailsResult>();

  setHandler(getSigningStateQuery, () => state);
  setHandler(contractSignedSignal, (signed) => {
    signature ??= signed;
  });
  setHandler(
    submitPaymentDetailsUpdate,
    async (details) => {
      const id = ++submissionCount;
      submission = { id, details: { iban: normalizeIban(details.iban), accountHolder: details.accountHolder.trim() } };
      await condition(() => verdicts.has(id));
      const verdict = verdicts.get(id)!;
      verdicts.delete(id);
      return verdict;
    },
    {
      validator: (details) => {
        if (state.stage !== 'AWAITING_AGENT' || submission) throw new Error('No payment-details form is open');
        const error = ibanError(details?.iban);
        if (error) throw new Error(error);
        if (!details.accountHolder?.trim()) throw new Error('Account holder is required');
      },
    },
  );

  async function setLeadStatus(status: OnboardingStatus, note?: string): Promise<void> {
    leadStatus = status;
    await local.updateLeadStatus(leadId, status, note);
  }

  // The parent stays CONTRACTING; the lead row in the database shows the parked step.
  const recovery = createOperatorRecovery({
    async onPark(parked) {
      state.needsAttention = parked;
      await local.updateLeadStatus(leadId, 'NEEDS_ATTENTION', `${parked.step}: ${parked.error}`);
    },
    async onResume(parked, command) {
      state.needsAttention = undefined;
      await local.updateLeadStatus(leadId, leadStatus, `Operator ${command.action} at ${parked.step}`);
    },
  });

  /** Returns why these payment details can't be used, or undefined when they are fine. */
  async function paymentDetailsProblem(details: PaymentDetails): Promise<string | undefined> {
    const formatError = ibanError(details.iban);
    if (formatError) return formatError;
    if (!namesMatch(details.accountHolder, customerName)) {
      return `The account must be in the customer's name (${customerName}), not "${details.accountHolder}"`;
    }
    const check = await recovery.guard('verifyBankAccount', () => external.verifyBankAccount(leadId, details));
    const iban = formatIban(details.iban);
    switch (check.result) {
      case 'MATCH':
        return undefined;
      case 'NO_MATCH':
        return `Bank: ${iban} is registered to "${check.registeredName}", not "${details.accountHolder}"`;
      case 'ACCOUNT_CLOSED':
        return `Bank: ${iban} is closed`;
      case 'NOT_FOUND':
        return `Bank: ${iban} does not exist`;
    }
  }

  /** Verifies the application's IBAN; while it is missing or rejected, an agent form is open. */
  async function collectPaymentDetails(): Promise<PaymentMandate> {
    let candidate: PaymentDetails | undefined = input.iban
      ? { iban: input.iban, accountHolder: customerName }
      : undefined;
    let reason = 'No IBAN in the application';
    let submissionId: number | undefined;
    let rejectedSubmissions = 0;

    for (;;) {
      if (candidate) {
        state.stage = 'VERIFYING_PAYMENT_DETAILS';
        const problem = await paymentDetailsProblem(candidate);
        if (!problem) break;

        if (submissionId === undefined) {
          reason = `IBAN from the application was rejected. ${problem}`;
        } else {
          reason = problem;
          rejectedSubmissions++;
        }
      }

      // (Re)open the form and wait for the agent.
      state.agentForm = {
        type: 'COLLECT_IBAN',
        leadId,
        customerName,
        reason,
        rejectedSubmissions,
        openedAt: state.agentForm?.openedAt ?? new Date().toISOString(),
        prefill: { accountHolder: candidate?.accountHolder ?? customerName, iban: candidate?.iban },
      };
      await local.openAgentTask(leadId, workflowId, 'COLLECT_IBAN', reason);
      await setLeadStatus('AWAITING_AGENT', reason);
      state.stage = 'AWAITING_AGENT';
      // Answer the rejected submission only now that the form is open again, so the agent can
      // resubmit straight away.
      if (submissionId !== undefined) verdicts.set(submissionId, { accepted: false, reason, rejectedSubmissions });

      await condition(() => submission !== undefined);
      candidate = submission!.details;
      submissionId = submission!.id;
      submission = undefined;
    }

    const fromAgent = submissionId !== undefined;
    const mandate = await local.savePaymentMandate(leadId, candidate, fromAgent ? 'AGENT' : 'APPLICATION');
    if (state.agentForm) {
      await local.completeAgentTask(leadId, workflowId, 'COLLECT_IBAN');
      state.agentForm = undefined;
    }
    if (fromAgent) verdicts.set(submissionId!, { accepted: true, mandate });
    return mandate;
  }

  const draft = await local.createContract(leadId, quote);
  state.contract = draft;

  const mandate = await collectPaymentDetails();
  state.mandate = mandate;

  state.stage = 'SENDING_FOR_SIGNATURE';
  const contract = await recovery.guard('requestSignature', () =>
    external.requestSignature(leadId, draft.contractId, signerEmail),
  );
  state.contract = contract;
  await recovery.guard('sendEmail:contract-ready', () =>
    external.sendEmail(leadId, signerEmail, 'contract-ready', { signingUrl: contract.signingUrl }),
  );
  await setLeadStatus('AWAITING_SIGNATURE');

  state.stage = 'AWAITING_SIGNATURE';
  const signed = await condition(() => signature !== undefined, input.signatureTimeout ?? '14 days');
  await condition(allHandlersFinished);
  if (!signed) {
    await local.expireContract(leadId, contract.contractId);
    state.stage = 'EXPIRED';
    return { outcome: 'EXPIRED', contract, mandate };
  }

  state.stage = 'SIGNED';
  return { outcome: 'SIGNED', contract, mandate, signedAt: signature!.signedAt, signerName: signature!.signerName };
}
