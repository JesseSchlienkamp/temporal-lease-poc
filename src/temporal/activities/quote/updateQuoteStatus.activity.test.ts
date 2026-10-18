import { queryOne, runActivity, seedLead, seedQuote, useCleanDatabase } from '../common/testing';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { updateQuoteStatus } from './updateQuoteStatus.activity';

useCleanDatabase();

describe('updateQuoteStatus', () => {
  for (const status of ['ACCEPTED', 'DECLINED', 'EXPIRED'] as const) {
    it(`sets the quote to ${status}`, async () => {
      seedLead();
      const quoteId = seedQuote();
      await runActivity(updateQuoteStatus, quoteId, status);
      assert.equal(queryOne<{ status: string }>('SELECT status FROM quotes')?.status, status);
    });
  }
});
