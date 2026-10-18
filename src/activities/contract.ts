import { getDb } from '../db/database';
import type { Contract, Quote } from '../shared/types';
import { callExternal, tracked } from './support';

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

export async function activateLease(leadId: string, contractId: string, signedAt: string): Promise<void> {
  return tracked(leadId, 'activateLease', () => {
    const db = getDb();
    db.transaction(() => {
      db.prepare(`UPDATE contracts SET status = 'SIGNED', signed_at = ? WHERE id = ?`).run(signedAt, contractId);
      db.prepare(`UPDATE quotes SET status = 'ACCEPTED' WHERE lead_id = ?`).run(leadId);
      db.prepare(`UPDATE vehicle_reservations SET status = 'LEASED' WHERE lead_id = ? AND status = 'RESERVED'`).run(
        leadId,
      );
    })();
  });
}
