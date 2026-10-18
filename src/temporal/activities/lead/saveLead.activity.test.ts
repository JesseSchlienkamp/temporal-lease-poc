import { auditTrail, queryOne, runActivity, useCleanDatabase } from '../common/testing';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { saveLead } from './saveLead.activity';
import type { LeadInput } from './types';

useCleanDatabase();

const lead: LeadInput = {
  firstName: 'Jan',
  lastName: 'Jansen',
  email: 'jan@example.com',
  dateOfBirth: '1988-05-17',
  annualIncome: 62_000,
  vehicleModel: 'Volvo EX30',
};

describe('saveLead', () => {
  it('stores the lead with status LEAD_RECEIVED', async () => {
    await runActivity(saveLead, 'lead-1', lead);
    assert.deepEqual(
      queryOne('SELECT first_name, last_name, email, phone, date_of_birth, annual_income, vehicle_model, status FROM leads'),
      {
        first_name: 'Jan',
        last_name: 'Jansen',
        email: 'jan@example.com',
        phone: null,
        date_of_birth: '1988-05-17',
        annual_income: 62_000,
        vehicle_model: 'Volvo EX30',
        status: 'LEAD_RECEIVED',
      },
    );
    assert.deepEqual(auditTrail('lead-1').map((e) => `${e.step}:${e.outcome}`), ['saveLead:STARTED', 'saveLead:SUCCEEDED']);
  });

  it('stores the phone number when given', async () => {
    await runActivity(saveLead, 'lead-1', { ...lead, phone: '+31 6 1234 5678' });
    assert.equal(queryOne<{ phone: string }>('SELECT phone FROM leads')?.phone, '+31 6 1234 5678');
  });

  it('is idempotent: a retry does not overwrite the stored lead', async () => {
    await runActivity(saveLead, 'lead-1', lead);
    await runActivity(saveLead, 'lead-1', { ...lead, vehicleModel: 'Kia EV6' });
    assert.equal(queryOne<{ n: number }>('SELECT COUNT(*) AS n FROM leads')?.n, 1);
    assert.equal(queryOne<{ vehicle_model: string }>('SELECT vehicle_model FROM leads')?.vehicle_model, 'Volvo EX30');
  });
});
