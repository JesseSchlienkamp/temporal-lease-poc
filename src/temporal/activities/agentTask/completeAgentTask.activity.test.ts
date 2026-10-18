import { queryOne, runActivity, seedLead, useCleanDatabase } from '../common/testing';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { completeAgentTask } from './completeAgentTask.activity';
import { openAgentTask } from './openAgentTask.activity';

useCleanDatabase();

describe('completeAgentTask', () => {
  it('marks the task COMPLETED and clears its reason', async () => {
    seedLead();
    await runActivity(openAgentTask, 'lead-1', 'lead-1-signing', 'COLLECT_IBAN', 'No IBAN');
    await runActivity(completeAgentTask, 'lead-1', 'lead-1-signing', 'COLLECT_IBAN');
    assert.deepEqual(queryOne('SELECT status, reason, attempts FROM agent_tasks'), { status: 'COMPLETED', reason: null, attempts: 1 });
  });
});
