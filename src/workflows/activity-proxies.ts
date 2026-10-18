import { proxyActivities } from '@temporalio/workflow';
import type * as activities from '../activities';

// Local database work: fast, should practically never fail.
export const local = proxyActivities<typeof activities>({
  startToCloseTimeout: '10 seconds',
  retry: { maximumAttempts: 5 },
});

// Calls to external systems: these are the flaky ones. Temporal retries them with exponential
// backoff (1s, 2s, 4s, ... capped at 30s). Non-retryable failures (e.g. HTTP 404 for an unknown
// vehicle model) skip the retries and fail immediately.
export const external = proxyActivities<typeof activities>({
  startToCloseTimeout: '10 seconds', // a hanging call is abandoned after 10s and retried
  retry: {
    initialInterval: '1 second',
    backoffCoefficient: 2,
    maximumInterval: '30 seconds',
    maximumAttempts: 10,
    nonRetryableErrorTypes: ['ExternalServiceRejected'],
  },
});

// The e-signature provider: a short leash. Three attempts, then the activity fails for real and
// takes the signing child down with it (no operator parking inside the child). The parent then
// decides: retry the whole signing child, or abort the lead.
export const esign = proxyActivities<typeof activities>({
  startToCloseTimeout: '10 seconds',
  retry: {
    initialInterval: '1 second',
    backoffCoefficient: 2,
    maximumAttempts: 3,
    nonRetryableErrorTypes: ['ExternalServiceRejected'],
  },
});
