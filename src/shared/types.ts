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
  | 'AWAITING_SIGNATURE'
  | 'SIGNATURE_EXPIRED'
  | 'ACTIVE'
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
  /** Id of the contract-signing child workflow, once started. */
  signingWorkflowId?: string;
}
