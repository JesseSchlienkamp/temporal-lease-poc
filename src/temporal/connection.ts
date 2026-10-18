import { Connection, type ConnectionOptions } from '@temporalio/client';
import { NativeConnection } from '@temporalio/worker';
import { config } from '../config';

const { address, namespace, apiKey, tls } = config.temporal;

// Works for a local dev server (no TLS), Temporal Cloud (API key + TLS)
// and a self-hosted server behind TLS-terminating ingress (TEMPORAL_TLS=true).
const connectionOptions = {
  address,
  tls,
  apiKey,
  metadata: apiKey ? { 'temporal-namespace': namespace } : undefined,
};

export const connectClient = (overrides: Partial<ConnectionOptions> = {}) =>
  Connection.connect({ ...connectionOptions, ...overrides });
export const connectWorker = () => NativeConnection.connect(connectionOptions);
