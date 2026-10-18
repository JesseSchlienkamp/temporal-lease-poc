// Lead domain: the application and the lead's status as stored in the leads table.

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

export type LeadStatus =
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
