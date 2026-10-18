// Types of the mock external services.

export type ServiceName = 'creditBureau' | 'inventory' | 'esign' | 'notifications' | 'bank';

/** Failure injection per service. See the header of server.ts. */
export interface Chaos {
  failFirstN: number;
  failureRate: number;
  latencyMs: number;
  errorStatus: number;
}

export interface BankAccount {
  holder: string;
  closed?: boolean;
}

export interface Reservation {
  reservationId: string;
  vin: string;
  vehicleModel: string;
  listPrice: number;
}
