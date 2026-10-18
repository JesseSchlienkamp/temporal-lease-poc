import { getDb } from '../../db/database';
import { callExternal, tracked } from '../common/activity-support';

/** Compensation: give the car back to the inventory when onboarding does not complete. */
export async function releaseVehicle(leadId: string, reservationId: string): Promise<void> {
  return tracked(leadId, 'releaseVehicle', async () => {
    await callExternal('DELETE', `/inventory/reservations/${encodeURIComponent(reservationId)}`);
    getDb()
      .prepare(`UPDATE vehicle_reservations SET status = 'RELEASED' WHERE reservation_id = ?`)
      .run(reservationId);
  });
}
