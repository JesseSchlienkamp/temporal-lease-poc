import { json, queryOne, runActivity, seedLead, useCleanDatabase, useFakeFetch } from '../common/testing';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { LeadInput } from '../lead/types';
import { runCreditCheck } from './runCreditCheck.activity';

useCleanDatabase();
const http = useFakeFetch();

const lead: LeadInput = {
  firstName: 'Jan',
  lastName: 'Jansen',
  email: 'jan@example.com',
  dateOfBirth: '1988-05-17',
  annualIncome: 62_000,
  vehicleModel: 'Volvo EX30',
};

describe('runCreditCheck', () => {
  it('asks the bureau for a score, keyed by lead', async () => {
    seedLead();
    http.respond(json(200, { score: 700, reference: 'CB-1' }));
    await runActivity(runCreditCheck, 'lead-1', lead);
    assert.equal(http.last.url, 'http://mocks.test/credit-bureau/score');
    assert.equal(http.last.headers['idempotency-key'], 'lead-1');
    assert.deepEqual(http.last.body, {
      firstName: 'Jan',
      lastName: 'Jansen',
      dateOfBirth: '1988-05-17',
      email: 'jan@example.com',
    });
  });

  it('approves a score of 620 and stores the result', async () => {
    seedLead();
    http.respond(json(200, { score: 620, reference: 'CB-1' }));
    assert.deepEqual(await runActivity(runCreditCheck, 'lead-1', lead), {
      score: 620,
      decision: 'APPROVED',
      bureauReference: 'CB-1',
    });
    assert.deepEqual(queryOne('SELECT score, decision, bureau_reference FROM credit_checks'), {
      score: 620,
      decision: 'APPROVED',
      bureau_reference: 'CB-1',
    });
  });

  it('rejects a score below 620', async () => {
    seedLead();
    http.respond(json(200, { score: 619, reference: 'CB-2' }));
    assert.equal((await runActivity(runCreditCheck, 'lead-1', lead)).decision, 'REJECTED');
  });

  it('overwrites the stored result on a later check', async () => {
    seedLead();
    http.respond(json(200, { score: 540, reference: 'CB-1' }));
    await runActivity(runCreditCheck, 'lead-1', lead);
    http.respond(json(200, { score: 700, reference: 'CB-2' }));
    await runActivity(runCreditCheck, 'lead-1', lead);
    assert.equal(queryOne<{ n: number }>('SELECT COUNT(*) AS n FROM credit_checks')?.n, 1);
    assert.deepEqual(queryOne('SELECT score, decision, bureau_reference FROM credit_checks'), {
      score: 700,
      decision: 'APPROVED',
      bureau_reference: 'CB-2',
    });
  });

  it('stores nothing when the bureau is down', async () => {
    seedLead();
    http.respond(json(503, { error: 'down' }));
    await assert.rejects(runActivity(runCreditCheck, 'lead-1', lead), /HTTP 503/);
    assert.equal(queryOne<{ n: number }>('SELECT COUNT(*) AS n FROM credit_checks')?.n, 0);
  });
});
