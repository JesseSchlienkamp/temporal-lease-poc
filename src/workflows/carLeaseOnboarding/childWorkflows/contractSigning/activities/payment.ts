import { getDb } from '../../../../../db/database';
import { normalizeIban } from '../../../../../shared/iban';
import type { BankAccountCheck, MandateSource, PaymentDetails, PaymentMandate } from '../types';
import { callExternal, tracked } from '../../../../common/activity-support';

/** IBAN-name check at the (mock) bank: does this account exist, is it open, and is it in this name? */
export async function verifyBankAccount(leadId: string, details: PaymentDetails): Promise<BankAccountCheck> {
  return tracked(leadId, 'verifyBankAccount', () =>
    callExternal<BankAccountCheck>(
      'POST',
      '/bank/account-check',
      { iban: normalizeIban(details.iban), accountHolder: details.accountHolder },
      `${leadId}:${normalizeIban(details.iban)}`,
    ),
  );
}

export async function findPaymentMandate(leadId: string): Promise<PaymentMandate | null> {
  const row = getDb()
    .prepare('SELECT mandate_reference, iban, account_holder FROM payment_mandates WHERE lead_id = ?')
    .get(leadId) as { mandate_reference: string; iban: string; account_holder: string } | undefined;
  return row ? { mandateReference: row.mandate_reference, iban: row.iban, accountHolder: row.account_holder } : null;
}

export async function savePaymentMandate(
  leadId: string,
  details: PaymentDetails,
  source: MandateSource,
): Promise<PaymentMandate> {
  return tracked(leadId, 'savePaymentMandate', () => {
    const mandate: PaymentMandate = {
      mandateReference: `MANDATE-${leadId}`,
      iban: normalizeIban(details.iban),
      accountHolder: details.accountHolder.trim(),
    };
    getDb()
      .prepare(
        `INSERT INTO payment_mandates (lead_id, mandate_reference, iban, account_holder, source) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(lead_id) DO UPDATE SET iban = excluded.iban, account_holder = excluded.account_holder,
           source = excluded.source`,
      )
      .run(leadId, mandate.mandateReference, mandate.iban, mandate.accountHolder, source);
    return mandate;
  });
}
