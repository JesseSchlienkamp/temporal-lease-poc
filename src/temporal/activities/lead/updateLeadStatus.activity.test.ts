import { queryOne, runActivity, seedLead, useCleanDatabase } from '../common/testing';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { updateLeadStatus } from './updateLeadStatus.activity';

useCleanDatabase();

describe('updateLeadStatus', () => {
  it('sets the status and note', async () => {
    seedLead();
    await runActivity(updateLeadStatus, 'lead-1', 'QUOTE_SENT', 'EUR 499/month');
    assert.deepEqual(queryOne('SELECT status, status_note FROM leads'), { status: 'QUOTE_SENT', status_note: 'EUR 499/month' });
  });

  it('clears the note when none is given', async () => {
    seedLead();
    await runActivity(updateLeadStatus, 'lead-1', 'QUALIFIED', 'old note');
    await runActivity(updateLeadStatus, 'lead-1', 'CREDIT_APPROVED');
    assert.deepEqual(queryOne('SELECT status, status_note FROM leads'), { status: 'CREDIT_APPROVED', status_note: null });
  });
});
