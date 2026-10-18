import { getDb } from '../db/database';
import type { VehicleReservation } from '../shared/types';
import { callExternal, tracked } from './support';

/** Reserves a car in the (flaky, slow) inventory system. Unknown models fail non-retryably (HTTP 404). */
export async function reserveVehicle(leadId: string, vehicleModel: string): Promise<VehicleReservation> {
  return tracked(leadId, 'reserveVehicle', async () => {
    const reservation = await callExternal<VehicleReservation>(
      'POST',
      '/inventory/reservations',
      { leadId, vehicleModel },
      leadId,
    );

    getDb()
      .prepare(
        `INSERT INTO vehicle_reservations (reservation_id, lead_id, vehicle_model, vin, list_price, status)
         VALUES (?, ?, ?, ?, ?, 'RESERVED')
         ON CONFLICT(reservation_id) DO NOTHING`,
      )
      .run(reservation.reservationId, leadId, reservation.vehicleModel, reservation.vin, reservation.listPrice);

    return reservation;
  });
}

/** Compensation: give the car back to the inventory when onboarding does not complete. */
export async function releaseVehicle(leadId: string, reservationId: string): Promise<void> {
  return tracked(leadId, 'releaseVehicle', async () => {
    await callExternal('DELETE', `/inventory/reservations/${encodeURIComponent(reservationId)}`);
    getDb()
      .prepare(`UPDATE vehicle_reservations SET status = 'RELEASED' WHERE reservation_id = ?`)
      .run(reservationId);
  });
}
