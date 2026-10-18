import { runActivity, useCleanDatabase } from '../common/testing';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { qualifyLead } from './qualifyLead.activity';
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

/** ISO date `years` ago, shifted by `days` (positive = later in the year). */
function bornYearsAgo(years: number, { months = 0, days = 0 } = {}): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() - years, d.getMonth() + months, d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

describe('qualifyLead', () => {
  it('qualifies a valid applicant', async () => {
    assert.deepEqual(await runActivity(qualifyLead, 'lead-1', lead), { qualified: true });
  });

  it('rejects an invalid date of birth', async () => {
    assert.deepEqual(await runActivity(qualifyLead, 'lead-1', { ...lead, dateOfBirth: 'not a date' }), {
      qualified: false,
      reason: 'Invalid date of birth: not a date',
    });
  });

  it('rejects applicants under 18', async () => {
    const result = await runActivity(qualifyLead, 'lead-1', { ...lead, dateOfBirth: bornYearsAgo(17) });
    assert.deepEqual(result, { qualified: false, reason: 'Applicant must be at least 18' });
  });

  it('accepts someone who turned 18 today', async () => {
    assert.equal((await runActivity(qualifyLead, 'lead-1', { ...lead, dateOfBirth: bornYearsAgo(18) })).qualified, true);
  });

  it('rejects someone who turns 18 later this month', async () => {
    const dateOfBirth = bornYearsAgo(18, { days: 1 });
    // Only meaningful when tomorrow is in the same month; otherwise the next test covers it.
    if (new Date(dateOfBirth).getMonth() === new Date().getMonth()) {
      assert.equal((await runActivity(qualifyLead, 'lead-1', { ...lead, dateOfBirth })).qualified, false);
    }
  });

  it('rejects someone who turns 18 in a later month', async () => {
    const result = await runActivity(qualifyLead, 'lead-1', { ...lead, dateOfBirth: bornYearsAgo(18, { months: 1 }) });
    assert.equal(result.qualified, false);
  });

  it('rejects an income below 25,000', async () => {
    assert.deepEqual(await runActivity(qualifyLead, 'lead-1', { ...lead, annualIncome: 24_999 }), {
      qualified: false,
      reason: 'Annual income below 25000',
    });
  });

  for (const email of ['jan', 'jan@', 'jan@example', 'jan @example.com']) {
    it(`rejects the email address "${email}"`, async () => {
      assert.deepEqual(await runActivity(qualifyLead, 'lead-1', { ...lead, email }), {
        qualified: false,
        reason: 'Invalid email address',
      });
    });
  }
});
