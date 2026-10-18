import { getDb } from '../../../../../../db/database';
import type { PaymentMandate } from '../../types';

export async function findPaymentMandate(leadId: string): Promise<PaymentMandate | null> {
  const row = getDb()
    .prepare('SELECT mandate_reference, iban, account_holder FROM payment_mandates WHERE lead_id = ?')
    .get(leadId) as { mandate_reference: string; iban: string; account_holder: string } | undefined;
  return row ? { mandateReference: row.mandate_reference, iban: row.iban, accountHolder: row.account_holder } : null;
}
