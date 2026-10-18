import { getDb } from '../../db/database';
import type { Quote } from '../quote/types';
import type { Contract } from './types';
import { tracked } from '../common/activity-support';

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
