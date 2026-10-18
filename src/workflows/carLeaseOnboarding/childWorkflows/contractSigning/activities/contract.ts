import { getDb } from '../../../../../db/database';
import type { Quote } from '../../../types';
import type { Contract } from '../types';
import { callExternal, tracked } from '../../../../common/activity-support';

export async function createContract(leadId: string, quote: Quote): Promise<Contract> {
  return tracked(leadId, 'createContract', () => {
    const contractId = `${leadId}-contract`;
    getDb()
      .prepare(
        `INSERT INTO contracts (id, lead_id, quote_id, status) VALUES (?, ?, ?, 'DRAFT')
         ON CONFLICT(id) DO NOTHING`,
      )
      .run(contractId, leadId, quote.quoteId);
    return { contractId };
  });
}

/** Sends the contract to the e-signature provider. Reliable by default; `npm run chaos -- esign down` makes it return 502. */
export async function requestSignature(leadId: string, contractId: string, email: string): Promise<Contract> {
  return tracked(leadId, 'requestSignature', async () => {
    const { envelopeId, signingUrl } = await callExternal<{ envelopeId: string; signingUrl: string }>(
      'POST',
      '/esign/envelopes',
      { contractId, signerEmail: email },
      contractId,
    );
    getDb()
      .prepare(`UPDATE contracts SET envelope_id = ?, status = 'SENT_FOR_SIGNATURE' WHERE id = ?`)
      .run(envelopeId, contractId);
    return { contractId, envelopeId, signingUrl };
  });
}

export async function expireContract(leadId: string, contractId: string): Promise<void> {
  return tracked(leadId, 'expireContract', () => {
    getDb().prepare(`UPDATE contracts SET status = 'EXPIRED' WHERE id = ?`).run(contractId);
  });
}
