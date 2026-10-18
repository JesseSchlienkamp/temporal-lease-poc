import { queryOne, runActivity, seedLead, useCleanDatabase, useFakeFetch } from '../common/testing';
import { getDb } from '../../../db/database';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { releaseVehicle } from './releaseVehicle.activity';

useCleanDatabase();
const http = useFakeFetch();

describe('releaseVehicle', () => {
  it('releases at the inventory and marks the reservation RELEASED', async () => {
    seedLead();
    getDb()
      .prepare(
        `INSERT INTO vehicle_reservations (reservation_id, lead_id, vehicle_model, vin, list_price, status)
         VALUES ('RES 1/a', 'lead-1', 'Volvo EX30', 'VIN1', 38995, 'RESERVED')`,
      )
      .run();
    await runActivity(releaseVehicle, 'lead-1', 'RES 1/a');
    assert.equal(http.last.method, 'DELETE');
    assert.equal(http.last.url, 'http://mocks.test/inventory/reservations/RES%201%2Fa');
    assert.equal(queryOne<{ status: string }>('SELECT status FROM vehicle_reservations')?.status, 'RELEASED');
  });
});
