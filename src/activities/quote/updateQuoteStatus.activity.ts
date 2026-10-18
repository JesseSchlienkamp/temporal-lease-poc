import type { QuoteStatus } from './types';
import { getDb } from '../../db/database';

export async function updateQuoteStatus(quoteId: string, status: Exclude<QuoteStatus, 'SENT'>): Promise<void> {
  getDb().prepare('UPDATE quotes SET status = ? WHERE id = ?').run(status, quoteId);
}
