// Credit domain: the credit bureau's verdict.

export interface CreditCheckResult {
  score: number;
  decision: 'APPROVED' | 'REJECTED';
  bureauReference: string;
}
