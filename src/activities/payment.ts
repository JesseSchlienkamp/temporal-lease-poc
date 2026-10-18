import { getDb } from '../db/database';
import { normalizeIban } from '../shared/iban';
import type { BankAccountCheck, PaymentDetails, PaymentMandate } from '../shared/types';
import { callExternal, tracked } from './support';

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

export async function savePaymentMandate(
  leadId: string,
  details: PaymentDetails,
  source: 'APPLICATION' | 'AGENT',
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
