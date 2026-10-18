import { queryOne, runActivity, seedLead, seedQuote, useCleanDatabase } from '../common/testing';
import { getDb } from '../../../db/database';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { expireContract } from './expireContract.activity';

useCleanDatabase();

describe('expireContract', () => {
  it('marks the contract EXPIRED', async () => {
    seedLead();
    getDb().prepare(`INSERT INTO contracts (id, lead_id, quote_id, status) VALUES ('C-1', 'lead-1', ?, 'SENT_FOR_SIGNATURE')`).run(seedQuote());
    await runActivity(expireContract, 'lead-1', 'C-1');
    assert.equal(queryOne<{ status: string }>('SELECT status FROM contracts')?.status, 'EXPIRED');
  });
});
