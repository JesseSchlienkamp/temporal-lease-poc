import { getDb } from '../../../../db/database';
import type { CreditCheckResult, LeadInput } from '../../types';
import { callExternal, tracked } from '../../../common/activity-support';

const MIN_CREDIT_SCORE = 620;

/** Calls the (flaky) external credit bureau. By default it fails the first 2 calls per lead. */
export async function runCreditCheck(leadId: string, lead: LeadInput): Promise<CreditCheckResult> {
  return tracked(leadId, 'runCreditCheck', async () => {
    const { score, reference } = await callExternal<{ score: number; reference: string }>(
      'POST',
      '/credit-bureau/score',
      { firstName: lead.firstName, lastName: lead.lastName, dateOfBirth: lead.dateOfBirth, email: lead.email },
      leadId,
    );

    const result: CreditCheckResult = {
      score,
      decision: score >= MIN_CREDIT_SCORE ? 'APPROVED' : 'REJECTED',
      bureauReference: reference,
    };

    getDb()
      .prepare(
        `INSERT INTO credit_checks (lead_id, score, decision, bureau_reference) VALUES (?, ?, ?, ?)
         ON CONFLICT(lead_id) DO UPDATE SET score = excluded.score, decision = excluded.decision,
           bureau_reference = excluded.bureau_reference`,
      )
      .run(leadId, result.score, result.decision, result.bureauReference);

    return result;
  });
}
