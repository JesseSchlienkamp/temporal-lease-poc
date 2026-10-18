import { getDb } from '../../../../../../db/database';
import type { Contract } from '../../types';
import { callExternal, tracked } from '../../../../../common/activity-support';

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
