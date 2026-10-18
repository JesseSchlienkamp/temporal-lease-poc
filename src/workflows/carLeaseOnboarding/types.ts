// Types of the carLeaseOnboarding workflow: input, options, state and messages. Activity payloads
// live with their domain under src/activities. Type-only: safe to import in the workflow sandbox.
import type { Duration } from '@temporalio/common';
import type { Contract } from '../../activities/contract/types';
import type { LeadInput, LeadStatus } from '../../activities/lead/types';
import type { PaymentMandate } from '../../activities/payment/types';
import type { Quote } from '../../activities/quote/types';
import type { VehicleReservation } from '../../activities/vehicle/types';
import type { ParkedStep } from '../common/types';

/** The workflow's input is the lead application. */
export type { LeadInput };

/** The onboarding status is persisted as the lead's status. */
export type OnboardingStatus = LeadStatus;

export interface OnboardingOptions {
  /** How long the customer has to accept the quote (e.g. '7 days', '30 seconds'). */
  quoteDecisionTimeout?: Duration;
  /** How long the customer has to sign the contract. */
  signatureTimeout?: Duration;
}

// --- State (returned by the getState query and as the workflow result) ---------------------------

export interface StatusChange {
  status: OnboardingStatus;
  at: string;
  note?: string;
}

export interface OnboardingState {
  leadId: string;
  status: OnboardingStatus;
  history: StatusChange[];
  creditScore?: number;
  reservation?: VehicleReservation;
  quote?: Quote;
  contract?: Contract;
  /** Set while a step has exhausted its retries and waits for an operator. */
  needsAttention?: ParkedStep;
  /** Direct-debit mandate, once the signing child has verified the IBAN. */
  mandate?: PaymentMandate;
  /** Id of the contract-signing child workflow, once started. */
  signingWorkflowId?: string;
}

// --- Messages ------------------------------------------------------------------------------------

export interface QuoteDecision {
  accepted: boolean;
  reason?: string;
}
