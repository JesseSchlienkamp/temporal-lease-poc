import { ApplicationFailure, Context, log } from '@temporalio/activity';
import { config } from '../../../config';
import { getDb } from '../../../db/database';
import type { AuditOutcome } from './types';


function currentAttempt(): number {
  try {
    return Context.current().info.attempt;
  } catch {
    return 0; // called outside an activity (e.g. a script)
  }
}

export function recordEvent(leadId: string, step: string, outcome: AuditOutcome, detail?: string): void {
  getDb()
    .prepare('INSERT INTO workflow_events (lead_id, step, attempt, outcome, detail) VALUES (?, ?, ?, ?, ?)')
    .run(leadId, step, currentAttempt(), outcome, detail ?? null);
}

/** Runs an activity body and writes STARTED / SUCCEEDED / FAILED rows (with attempt number) to the audit table. */
export async function tracked<T>(leadId: string, step: string, fn: () => Promise<T> | T): Promise<T> {
  recordEvent(leadId, step, 'STARTED');
  try {
    const result = await fn();
    recordEvent(leadId, step, 'SUCCEEDED');
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.warn(`${step} failed on attempt ${currentAttempt()}`, { leadId, error: message });
    recordEvent(leadId, step, 'FAILED', message);
    throw err;
  }
}

/**
 * Calls one of the (mock) external services.
 *  - network errors, 5xx, 408 and 429  -> retryable: Temporal retries per the activity's retry policy
 *  - other 4xx                         -> non-retryable: fail fast, retrying will not help
 */
export async function callExternal<T>(
  method: 'GET' | 'POST' | 'DELETE',
  path: string,
  body?: unknown,
  idempotencyKey?: string,
): Promise<T> {
  const res = await fetch(`${config.mockServicesUrl}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(idempotencyKey ? { 'idempotency-key': idempotencyKey } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: Context.current().cancellationSignal,
  });

  if (res.ok) return (await res.json()) as T;

  const text = await res.text();
  const message = `${method} ${path} -> HTTP ${res.status}: ${text}`;
  if (res.status >= 500 || res.status === 408 || res.status === 429) {
    throw ApplicationFailure.retryable(message, 'ExternalServiceUnavailable');
  }
  throw ApplicationFailure.nonRetryable(message, 'ExternalServiceRejected');
}
