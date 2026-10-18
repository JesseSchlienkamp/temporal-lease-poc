import { getDb } from '../../../db/database';
import { tracked } from '../common/activity-support';
import type { AgentTaskType } from './types';
import { agentTaskId } from './agentTaskId';

/** Opens the task, or reopens it with a new reason and attempts + 1. */
export async function openAgentTask(
  leadId: string,
  workflowId: string,
  type: AgentTaskType,
  reason: string,
): Promise<void> {
  return tracked(leadId, `openAgentTask:${type}`, () => {
    getDb()
      .prepare(
        `INSERT INTO agent_tasks (id, lead_id, workflow_id, type, status, reason, attempts)
         VALUES (?, ?, ?, ?, 'OPEN', ?, 1)
         ON CONFLICT(id) DO UPDATE SET status = 'OPEN', reason = excluded.reason,
           attempts = agent_tasks.attempts + 1, updated_at = datetime('now')`,
      )
      .run(agentTaskId(workflowId, type), leadId, workflowId, type, reason);
  });
}
