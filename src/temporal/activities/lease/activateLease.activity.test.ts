import { query, queryOne, runActivity, seedLead, seedQuote, useCleanDatabase } from '../common/testing';
import { getDb } from '../../../db/database';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { activateLease } from './activateLease.activity';

useCleanDatabase();

function seedContractAndReservations() {
  seedLead();
  const quoteId = seedQuote();
  const db = getDb();
  db.prepare(`INSERT INTO contracts (id, lead_id, quote_id, status) VALUES ('C-1', 'lead-1', ?, 'SENT_FOR_SIGNATURE')`).run(quoteId);
  const reservation = db.prepare(
    `INSERT INTO vehicle_reservations (reservation_id, lead_id, vehicle_model, vin, list_price, status)
     VALUES (?, 'lead-1', 'Volvo EX30', 'VIN', 38995, ?)`,
  );
  reservation.run('RES-old', 'RELEASED');
  reservation.run('RES-1', 'RESERVED');
}

describe('activateLease', () => {
  it('marks the contract signed, the quote accepted and the reserved car leased', async () => {
    seedContractAndReservations();
    await runActivity(activateLease, 'lead-1', 'C-1', '2026-10-18T12:00:00Z');
    assert.deepEqual(queryOne('SELECT status, signed_at FROM contracts'), { status: 'SIGNED', signed_at: '2026-10-18T12:00:00Z' });
    assert.equal(queryOne<{ status: string }>('SELECT status FROM quotes')?.status, 'ACCEPTED');
    assert.deepEqual(query('SELECT reservation_id, status FROM vehicle_reservations ORDER BY reservation_id'), [
      { reservation_id: 'RES-1', status: 'LEASED' },
      { reservation_id: 'RES-old', status: 'RELEASED' }, // an earlier, released reservation is left alone
    ]);
  });
});
