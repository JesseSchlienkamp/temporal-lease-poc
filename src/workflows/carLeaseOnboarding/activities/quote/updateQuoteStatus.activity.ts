import { getDb } from '../../../../db/database';

export async function updateQuoteStatus(quoteId: string, status: 'ACCEPTED' | 'DECLINED' | 'EXPIRED'): Promise<void> {
  getDb().prepare('UPDATE quotes SET status = ? WHERE id = ?').run(status, quoteId);
}
