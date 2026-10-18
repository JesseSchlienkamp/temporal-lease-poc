import { normalizeIban } from '../../../../../../shared/iban';
import type { BankAccountCheck, PaymentDetails } from '../../types';
import { callExternal, tracked } from '../../../../../common/activity-support';

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
