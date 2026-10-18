import { queryOne, runActivity, seedLead, useCleanDatabase } from '../common/testing';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { completeAgentTask } from './completeAgentTask.activity';
import { openAgentTask } from './openAgentTask.activity';

useCleanDatabase();

const row = () => queryOne('SELECT id, lead_id, workflow_id, type, status, reason, attempts FROM agent_tasks');

describe('openAgentTask', () => {
  it('opens a task and returns a link to it in the agent inbox', async () => {
    seedLead();
    const link = await runActivity(openAgentTask, 'lead-1', 'lead-1-signing', 'COLLECT_IBAN', 'No IBAN');
    assert.deepEqual(link, {
      taskId: 'lead-1-signing:COLLECT_IBAN',
      url: 'http://agent.test/agent?task=lead-1-signing',
    });
    assert.deepEqual(row(), {
      id: 'lead-1-signing:COLLECT_IBAN',
      lead_id: 'lead-1',
      workflow_id: 'lead-1-signing',
      type: 'COLLECT_IBAN',
      status: 'OPEN',
      reason: 'No IBAN',
      attempts: 1,
    });
  });

  it('reopens a task with the new reason and attempts + 1', async () => {
    seedLead();
    await runActivity(openAgentTask, 'lead-1', 'lead-1-signing', 'COLLECT_IBAN', 'No IBAN');
    await runActivity(completeAgentTask, 'lead-1', 'lead-1-signing', 'COLLECT_IBAN');
    await runActivity(openAgentTask, 'lead-1', 'lead-1-signing', 'COLLECT_IBAN', 'Bank: account closed');
    assert.deepEqual(row(), {
      id: 'lead-1-signing:COLLECT_IBAN',
      lead_id: 'lead-1',
      workflow_id: 'lead-1-signing',
      type: 'COLLECT_IBAN',
      status: 'OPEN',
      reason: 'Bank: account closed',
      attempts: 2,
    });
  });

  it('URL-encodes the workflow id in the link', async () => {
    seedLead();
    const link = await runActivity(openAgentTask, 'lead-1', 'odd id/1', 'COLLECT_IBAN', 'No IBAN');
    assert.equal(link.url, 'http://agent.test/agent?task=odd%20id%2F1');
  });
});
