import { queryOne, runActivity, seedLead, useCleanDatabase } from '../common/testing';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { savePaymentMandate } from './savePaymentMandate.activity';

useCleanDatabase();

describe('savePaymentMandate', () => {
  it('stores a normalised IBAN and trimmed holder, with its source', async () => {
    seedLead();
    const mandate = await runActivity(savePaymentMandate, 'lead-1', { iban: 'nl91 abna 0417 1643 00', accountHolder: '  Jan Jansen ' }, 'APPLICATION');
    assert.deepEqual(mandate, { mandateReference: 'MANDATE-lead-1', iban: 'NL91ABNA0417164300', accountHolder: 'Jan Jansen' });
    assert.deepEqual(queryOne('SELECT mandate_reference, iban, account_holder, source FROM payment_mandates'), {
      mandate_reference: 'MANDATE-lead-1',
      iban: 'NL91ABNA0417164300',
      account_holder: 'Jan Jansen',
      source: 'APPLICATION',
    });
  });

  it('replaces the IBAN, holder and source on a later save', async () => {
    seedLead();
    await runActivity(savePaymentMandate, 'lead-1', { iban: 'NL20INGB0001234567', accountHolder: 'P. de Vries' }, 'APPLICATION');
    await runActivity(savePaymentMandate, 'lead-1', { iban: 'NL91ABNA0417164300', accountHolder: 'Jan Jansen' }, 'AGENT');
    assert.deepEqual(queryOne('SELECT COUNT(*) AS n, iban, account_holder, source FROM payment_mandates'), {
      n: 1,
      iban: 'NL91ABNA0417164300',
      account_holder: 'Jan Jansen',
      source: 'AGENT',
    });
  });
});
