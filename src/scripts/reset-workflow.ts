/**
 * Resets a workflow to its first workflow task: a new run starts from the beginning, replaying the
 * original input and re-applying signals received after that point.
 *
 *   npm run reset -- <workflowId> [reason]
 *   npm run reset -- lead-1a2b3c4d-signing      # rerun only the contract-signing child
 *
 * Resetting the signing child does not touch the parent: the parent keeps waiting and receives the
 * result of the child's new run.
 */
import { Client } from '@temporalio/client';
import { randomUUID } from 'node:crypto';
import { config } from '../config';
import { connectClient } from '../temporal/connection';

/** Resets `workflowId` to its first completed workflow task. Returns the event id and the new run id. */
export async function resetToFirstWorkflowTask(client: Client, workflowId: string, reason: string) {
  const handle = client.workflow.getHandle(workflowId);
  const events = (await handle.fetchHistory()).events ?? [];
  const firstTask = events.find((e) => e.workflowTaskCompletedEventAttributes);
  if (!firstTask?.eventId) throw new Error(`No completed workflow task in the history of ${workflowId}`);

  const { runId } = await client.workflowService.resetWorkflowExecution({
    namespace: config.temporal.namespace,
    workflowExecution: { workflowId },
    workflowTaskFinishEventId: firstTask.eventId,
    reason,
    requestId: randomUUID(),
  });
  return { eventId: String(firstTask.eventId), runId: runId ?? '' };
}

async function main() {
  const [workflowId, reason = 'Reset from scripts/reset-workflow.ts'] = process.argv.slice(2);
  if (!workflowId) throw new Error('Usage: npm run reset -- <workflowId> [reason]');

  const client = new Client({ connection: await connectClient(), namespace: config.temporal.namespace });
  const { eventId, runId } = await resetToFirstWorkflowTask(client, workflowId, reason);
  console.log(`Reset ${workflowId} to event ${eventId}; new run ${runId}`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
