// Vehicle domain: reservations at the inventory.

export interface VehicleReservation {
  reservationId: string;
  vin: string;
  vehicleModel: string;
  listPrice: number;
}
