// Types of the contractSigning child workflow: input, result, state and messages. Activity
// payloads live with their domain under src/activities.
// Type-only: safe to import inside the workflow sandbox.
import type { Duration } from '@temporalio/common';
import type { AgentTaskType } from '../../activities/agentTask/types';
import type { Contract } from '../../activities/contract/types';
import type { PaymentDetails, PaymentMandate } from '../../activities/payment/types';
import type { Quote } from '../../activities/quote/types';
import type { ParkedStep } from '../common/types';

// --- Input / result ------------------------------------------------------------------------------

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

// --- State (returned by the getSigningState query) -----------------------------------------------

export type SigningStage =
  | 'CREATING_CONTRACT'
  | 'VERIFYING_PAYMENT_DETAILS'
  | 'AWAITING_AGENT'
  | 'SENDING_FOR_SIGNATURE'
  | 'AWAITING_SIGNATURE'
  | 'SIGNED'
  | 'EXPIRED';

export interface SigningState {
  stage: SigningStage;
  contract?: Contract;
  mandate?: PaymentMandate;
  /** Present while the workflow waits for an agent. */
  agentForm?: AgentForm;
  /** Set while a step has exhausted its retries and waits for an operator. */
  needsAttention?: ParkedStep;
}

/** An open work item for a human agent: supply a valid IBAN for the direct-debit mandate. */
export interface AgentForm {
  type: AgentTaskType;
  leadId: string;
  customerName: string;
  /** Why the form is (re)opened: missing IBAN, or why the previous value was rejected. */
  reason: string;
  /** Submissions rejected so far. */
  rejectedSubmissions: number;
  openedAt: string;
  prefill: { accountHolder: string; iban?: string };
}

// --- Messages ------------------------------------------------------------------------------------

export interface ContractSigned {
  signedAt: string;
  signerName?: string;
}

export type SubmitPaymentDetailsResult =
  | { accepted: true; mandate: PaymentMandate }
  | { accepted: false; reason: string; rejectedSubmissions: number };

/** An agent submission handed from the update handler to the workflow's main loop. */
export interface PendingSubmission {
  id: number;
  details: PaymentDetails;
}
