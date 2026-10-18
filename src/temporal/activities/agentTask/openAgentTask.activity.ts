import { config } from '../../../config';
import { getDb } from '../../../db/database';
import { tracked } from '../common/activity-support';
import type { AgentTaskLink, AgentTaskType } from './types';
import { agentTaskId } from './agentTaskId';

/**
 * Opens the task, or reopens it with a new reason and attempts + 1. Returns a link to the task in
 * the agent inbox, so it can be opened straight from the activity result in the Temporal UI.
 */
export async function openAgentTask(
  leadId: string,
  workflowId: string,
  type: AgentTaskType,
  reason: string,
): Promise<AgentTaskLink> {
  return tracked(leadId, `openAgentTask:${type}`, () => {
    const taskId = agentTaskId(workflowId, type);
    getDb()
      .prepare(
        `INSERT INTO agent_tasks (id, lead_id, workflow_id, type, status, reason, attempts)
         VALUES (?, ?, ?, ?, 'OPEN', ?, 1)
         ON CONFLICT(id) DO UPDATE SET status = 'OPEN', reason = excluded.reason,
           attempts = agent_tasks.attempts + 1, updated_at = datetime('now')`,
      )
      .run(taskId, leadId, workflowId, type, reason);
    return { taskId, url: `${config.agentPageUrl}?task=${encodeURIComponent(workflowId)}` };
  });
}
