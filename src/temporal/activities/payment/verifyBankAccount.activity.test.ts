import { json, runActivity, seedLead, useCleanDatabase, useFakeFetch } from '../common/testing';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { verifyBankAccount } from './verifyBankAccount.activity';

useCleanDatabase();
const http = useFakeFetch();

describe('verifyBankAccount', () => {
  it('sends the normalised IBAN and holder, keyed by lead and IBAN, and returns the bank result', async () => {
    seedLead();
    http.respond(json(200, { result: 'NO_MATCH', registeredName: 'P. de Vries' }));
    const result = await runActivity(verifyBankAccount, 'lead-1', { iban: 'nl20 ingb 0001 2345 67', accountHolder: 'Jan Jansen' });
    assert.deepEqual(result, { result: 'NO_MATCH', registeredName: 'P. de Vries' });
    assert.equal(http.last.url, 'http://mocks.test/bank/account-check');
    assert.equal(http.last.headers['idempotency-key'], 'lead-1:NL20INGB0001234567');
    assert.deepEqual(http.last.body, { iban: 'NL20INGB0001234567', accountHolder: 'Jan Jansen' });
  });

  it('fails retryably when the bank is down', async () => {
    seedLead();
    http.respond(json(503, { error: 'down' }));
    await assert.rejects(runActivity(verifyBankAccount, 'lead-1', { iban: 'NL91ABNA0417164300', accountHolder: 'Jan' }), /HTTP 503/);
  });
});
