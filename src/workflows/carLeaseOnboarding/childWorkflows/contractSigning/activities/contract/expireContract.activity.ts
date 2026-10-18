import { getDb } from '../../../../../../db/database';
import { tracked } from '../../../../../common/activity-support';

export async function expireContract(leadId: string, contractId: string): Promise<void> {
  return tracked(leadId, 'expireContract', () => {
    getDb().prepare(`UPDATE contracts SET status = 'EXPIRED' WHERE id = ?`).run(contractId);
  });
}
