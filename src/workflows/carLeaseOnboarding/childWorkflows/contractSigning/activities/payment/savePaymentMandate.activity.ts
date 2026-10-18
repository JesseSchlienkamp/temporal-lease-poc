import { getDb } from '../../../../../../db/database';
import { normalizeIban } from '../../../../../../shared/iban';
import type { MandateSource, PaymentDetails, PaymentMandate } from '../../types';
import { tracked } from '../../../../../common/activity-support';

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
