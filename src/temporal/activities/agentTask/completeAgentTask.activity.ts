import { getDb } from '../../../db/database';
import { tracked } from '../common/activity-support';
import type { AgentTaskType } from './types';
import { agentTaskId } from './agentTaskId';

export async function completeAgentTask(leadId: string, workflowId: string, type: AgentTaskType): Promise<void> {
  return tracked(leadId, `completeAgentTask:${type}`, () => {
    getDb()
      .prepare(`UPDATE agent_tasks SET status = 'COMPLETED', reason = NULL, updated_at = datetime('now') WHERE id = ?`)
      .run(agentTaskId(workflowId, type));
  });
}
