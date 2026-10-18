import { getDb } from '../../../db/database';
import type { LeadStatus as OnboardingStatus } from './types';

export async function updateLeadStatus(leadId: string, status: OnboardingStatus, note?: string): Promise<void> {
  getDb()
    .prepare(`UPDATE leads SET status = ?, status_note = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(status, note ?? null, leadId);
}
