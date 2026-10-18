// Types shared between workflows, activities and clients.
// Keep this file free of runtime imports: it is loaded inside the workflow sandbox.
import type { Duration } from '@temporalio/common';

export interface LeadInput {
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  /** ISO date, e.g. 1990-04-23 */
  dateOfBirth: string;
  annualIncome: number;
  /** One of the models known by the mock inventory, e.g. "Volvo EX30" */
  vehicleModel: string;
  termMonths?: number;
  annualKm?: number;
  downPayment?: number;
  /**
   * Bank account for the SEPA direct-debit mandate. Optional at application time, but required
   * before the contract can be sent for signature: when it is missing or fails verification, the
   * signing workflow opens a form for an agent.
   */
  iban?: string;
}

export interface OnboardingOptions {
  /** How long the customer has to accept the quote (e.g. '7 days', '30 seconds'). */
  quoteDecisionTimeout?: Duration;
  /** How long the customer has to sign the contract. */
  signatureTimeout?: Duration;
}

export type OnboardingStatus =
  | 'LEAD_RECEIVED'
  | 'QUALIFIED'
  | 'DISQUALIFIED'
  | 'CREDIT_APPROVED'
  | 'CREDIT_REJECTED'
  | 'VEHICLE_RESERVED'
  | 'QUOTE_SENT'
  | 'QUOTE_DECLINED'
  | 'QUOTE_EXPIRED'
  | 'CONTRACTING'
  | 'AWAITING_AGENT'
  | 'AWAITING_SIGNATURE'
  | 'SIGNATURE_EXPIRED'
  | 'ACTIVE'
  | 'NEEDS_ATTENTION'
  | 'FAILED';

export interface QualificationResult {
  qualified: boolean;
  reason?: string;
}

export interface CreditCheckResult {
  score: number;
  decision: 'APPROVED' | 'REJECTED';
  bureauReference: string;
}

export interface VehicleReservation {
  reservationId: string;
  vin: string;
  vehicleModel: string;
  listPrice: number;
}

export interface Quote {
  quoteId: string;
  monthlyPayment: number;
  termMonths: number;
  annualKm: number;
  downPayment: number;
}

export interface Contract {
  contractId: string;
  envelopeId?: string;
  signingUrl?: string;
}

export interface QuoteDecision {
  accepted: boolean;
  reason?: string;
}

export interface ContractSigned {
  signedAt: string;
  signerName?: string;
}

export interface OnboardingState {
  leadId: string;
  status: OnboardingStatus;
  history: { status: OnboardingStatus; at: string; note?: string }[];
  creditScore?: number;
  reservation?: VehicleReservation;
  quote?: Quote;
  contract?: Contract;
  /** Set while a step has exhausted its retries and waits for an operator. */
  needsAttention?: { step: string; error: string; since: string };
  /** Direct-debit mandate, once the signing child has verified the IBAN. */
  mandate?: PaymentMandate;
  /** Id of the contract-signing child workflow, once started. */
  signingWorkflowId?: string;
}

/** What an agent (or the customer's application) supplies for the direct-debit mandate. */
export interface PaymentDetails {
  iban: string;
  accountHolder: string;
}

/** Result of the bank's IBAN-name check. */
export interface BankAccountCheck {
  result: 'MATCH' | 'NO_MATCH' | 'ACCOUNT_CLOSED' | 'NOT_FOUND';
  registeredName?: string;
}

export interface PaymentMandate {
  mandateReference: string;
  iban: string;
  accountHolder: string;
}
