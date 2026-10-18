// Payment domain: IBAN, bank verification and the SEPA direct-debit mandate.

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

export type MandateSource = 'APPLICATION' | 'AGENT';
