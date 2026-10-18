import { json, query, runActivity, seedLead, useCleanDatabase, useFakeFetch } from '../common/testing';
import { ApplicationFailure } from '@temporalio/common';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { reserveVehicle } from './reserveVehicle.activity';

useCleanDatabase();
const http = useFakeFetch();

const reservation = { reservationId: 'RES-1', vin: 'VIN1', vehicleModel: 'Volvo EX30', listPrice: 38_995 };

describe('reserveVehicle', () => {
  it('reserves at the inventory and stores the reservation', async () => {
    seedLead();
    http.respond(json(201, reservation));
    assert.deepEqual(await runActivity(reserveVehicle, 'lead-1', 'Volvo EX30'), reservation);
    assert.equal(http.last.url, 'http://mocks.test/inventory/reservations');
    assert.equal(http.last.headers['idempotency-key'], 'lead-1');
    assert.deepEqual(http.last.body, { leadId: 'lead-1', vehicleModel: 'Volvo EX30' });
    assert.deepEqual(query('SELECT reservation_id, lead_id, vehicle_model, vin, list_price, status FROM vehicle_reservations'), [
      { reservation_id: 'RES-1', lead_id: 'lead-1', vehicle_model: 'Volvo EX30', vin: 'VIN1', list_price: 38_995, status: 'RESERVED' },
    ]);
  });

  it('is idempotent: a retry returning the same reservation stores it once', async () => {
    seedLead();
    http.respond(json(200, reservation));
    await runActivity(reserveVehicle, 'lead-1', 'Volvo EX30');
    await runActivity(reserveVehicle, 'lead-1', 'Volvo EX30');
    assert.equal(query('SELECT * FROM vehicle_reservations').length, 1);
  });

  it('fails non-retryably for an unknown model (HTTP 404)', async () => {
    seedLead();
    http.respond(json(404, { error: 'Unknown vehicle model' }));
    const err = await runActivity(reserveVehicle, 'lead-1', 'Fiat Multipla').catch((e: unknown) => e);
    assert.ok(err instanceof ApplicationFailure && err.nonRetryable);
    assert.equal(query('SELECT * FROM vehicle_reservations').length, 0);
  });
});
