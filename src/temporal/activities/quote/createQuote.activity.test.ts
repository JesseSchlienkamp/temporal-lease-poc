import { queryOne, runActivity, seedLead, useCleanDatabase } from '../common/testing';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { CreditCheckResult } from '../credit/types';
import type { LeadInput } from '../lead/types';
import type { VehicleReservation } from '../vehicle/types';
import { createQuote } from './createQuote.activity';

useCleanDatabase();

const lead: LeadInput = {
  firstName: 'Jan',
  lastName: 'Jansen',
  email: 'jan@example.com',
  dateOfBirth: '1988-05-17',
  annualIncome: 62_000,
  vehicleModel: 'Volvo EX30',
};
const reservation: VehicleReservation = { reservationId: 'RES-1', vin: 'VIN1', vehicleModel: 'Volvo EX30', listPrice: 38_995 };
const credit = (score: number): CreditCheckResult => ({ score, decision: 'APPROVED', bureauReference: 'CB-1' });

describe('createQuote', () => {
  it('uses 36 months, 15,000 km and no down payment by default', async () => {
    seedLead();
    const quote = await runActivity(createQuote, 'lead-1', lead, reservation, credit(643));
    // Same figure as the demo's Volvo EX30 at score 643.
    assert.deepEqual(quote, {
      quoteId: 'lead-1-quote',
      monthlyPayment: 695.94,
      termMonths: 36,
      annualKm: 15_000,
      downPayment: 0,
    });
    assert.deepEqual(queryOne('SELECT id, monthly_payment, term_months, annual_km, down_payment, status FROM quotes'), {
      id: 'lead-1-quote',
      monthly_payment: 695.94,
      term_months: 36,
      annual_km: 15_000,
      down_payment: 0,
      status: 'SENT',
    });
  });

  it('uses the term, mileage and down payment from the application', async () => {
    seedLead();
    const quote = await runActivity(
      createQuote,
      'lead-1',
      { ...lead, termMonths: 48, annualKm: 20_000, downPayment: 5_000 },
      reservation,
      credit(643),
    );
    assert.deepEqual([quote.termMonths, quote.annualKm, quote.downPayment], [48, 20_000, 5_000]);
  });

  it('gets cheaper with a better credit score (7.9 % / 5.9 % / 3.9 %)', async () => {
    seedLead();
    const monthly = async (score: number) => (await runActivity(createQuote, 'lead-1', lead, reservation, credit(score))).monthlyPayment;
    const [low, mid, high] = [await monthly(679), await monthly(680), await monthly(750)];
    assert.ok(low > mid && mid > high, `${low} > ${mid} > ${high}`);
    assert.equal(await monthly(749), mid);
  });

  it('caps the residual value between 30 % and 70 % of the list price', async () => {
    seedLead();
    const monthly = async (termMonths: number, annualKm: number) =>
      (await runActivity(createQuote, 'lead-1', { ...lead, termMonths, annualKm }, reservation, credit(643))).monthlyPayment;
    // Far beyond the caps, more mileage no longer changes the residual, so only the term matters.
    assert.equal(await monthly(36, 200_000), await monthly(36, 300_000)); // residual floor (30 %)
    // The ceiling is only reachable with very low mileage; negative values push the formula past 70 %.
    assert.equal(await monthly(24, -50_000), await monthly(24, -100_000)); // residual ceiling (70 %)
    assert.notEqual(await monthly(24, 0), await monthly(24, -100_000)); // 66 %: below the ceiling
  });

  it('is idempotent: a retry keeps the first quote', async () => {
    seedLead();
    await runActivity(createQuote, 'lead-1', lead, reservation, credit(643));
    await runActivity(createQuote, 'lead-1', lead, reservation, credit(800));
    assert.deepEqual(queryOne('SELECT COUNT(*) AS n, monthly_payment FROM quotes'), { n: 1, monthly_payment: 695.94 });
  });
});
