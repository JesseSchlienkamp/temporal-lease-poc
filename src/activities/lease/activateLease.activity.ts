import { getDb } from '../../db/database';
import { tracked } from '../common/activity-support';

/** Marks the signed contract, the quote and the vehicle reservation as final. */
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
