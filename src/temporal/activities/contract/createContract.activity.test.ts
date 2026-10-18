import { auditTrail, queryOne, runActivity, seedLead, seedQuote, useCleanDatabase } from '../common/testing';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Quote } from '../quote/types';
import { createContract } from './createContract.activity';

useCleanDatabase();

const quote = (quoteId: string): Quote => ({ quoteId, monthlyPayment: 499, termMonths: 36, annualKm: 15_000, downPayment: 0 });

describe('createContract', () => {
  it('creates a DRAFT contract for the quote', async () => {
    seedLead();
    const quoteId = seedQuote();
    assert.deepEqual(await runActivity(createContract, 'lead-1', quote(quoteId)), { contractId: 'lead-1-contract' });
    assert.deepEqual(queryOne('SELECT id, lead_id, quote_id, status FROM contracts'), {
      id: 'lead-1-contract',
      lead_id: 'lead-1',
      quote_id: quoteId,
      status: 'DRAFT',
    });
    assert.equal(auditTrail('lead-1').at(-1)?.outcome, 'SUCCEEDED');
  });

  it('is idempotent: a re-run (e.g. a new child run) keeps one contract', async () => {
    seedLead();
    const quoteId = seedQuote();
    await runActivity(createContract, 'lead-1', quote(quoteId));
    await runActivity(createContract, 'lead-1', quote(quoteId));
    assert.equal(queryOne<{ n: number }>('SELECT COUNT(*) AS n FROM contracts')?.n, 1);
  });
});
