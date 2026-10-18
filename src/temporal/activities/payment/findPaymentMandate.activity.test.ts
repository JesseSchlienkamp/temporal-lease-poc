import { runActivity, seedLead, useCleanDatabase } from '../common/testing';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { findPaymentMandate } from './findPaymentMandate.activity';
import { savePaymentMandate } from './savePaymentMandate.activity';

useCleanDatabase();

describe('findPaymentMandate', () => {
  it('returns null when the lead has no mandate yet', async () => {
    seedLead();
    assert.equal(await runActivity(findPaymentMandate, 'lead-1'), null);
  });

  it('returns the mandate a previous run saved', async () => {
    seedLead();
    await runActivity(savePaymentMandate, 'lead-1', { iban: 'NL91ABNA0417164300', accountHolder: 'Jan Jansen' }, 'AGENT');
    assert.deepEqual(await runActivity(findPaymentMandate, 'lead-1'), {
      mandateReference: 'MANDATE-lead-1',
      iban: 'NL91ABNA0417164300',
      accountHolder: 'Jan Jansen',
    });
  });
});
