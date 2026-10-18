import { existsSync } from 'node:fs';

// Load .env for local development. In Azure the values come from container app env vars.
if (existsSync('.env')) process.loadEnvFile('.env');

const env = (name: string, fallback: string): string => process.env[name] || fallback;

const apiKey = process.env.TEMPORAL_API_KEY || undefined;

export const config = {
  temporal: {
    address: env('TEMPORAL_ADDRESS', 'localhost:7233'),
    namespace: env('TEMPORAL_NAMESPACE', 'default'),
    apiKey,
    tls: process.env.TEMPORAL_TLS === 'true' || Boolean(apiKey),
  },
  taskQueue: env('TASK_QUEUE', 'car-lease-onboarding'),
  dbPath: env('DB_PATH', './data/leasing.db'),
  mockServicesUrl: env('MOCK_SERVICES_URL', 'http://localhost:8081'),
  apiPort: Number(env('PORT', '3000')),
  mockPort: Number(env('MOCK_PORT', '8081')),
};
