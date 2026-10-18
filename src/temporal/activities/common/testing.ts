// Test helpers for activities: in-memory SQLite, a fake fetch, and a mock activity context.
// Import this first in an activity test file.
import './testing-env';
import { MockActivityEnvironment } from '@temporalio/testing';
import { DefaultLogger } from '@temporalio/worker';
import { afterEach, beforeEach } from 'node:test';
import { getDb } from '../../../db/database';

// Activities log a warning on every failed attempt; keep test output to real problems.
const quietLogger = new DefaultLogger('ERROR');

/** Runs an activity inside a mock activity context (attempt number, cancellation signal). */
export function runActivity<A extends unknown[], R>(fn: (...args: A) => Promise<R>, ...args: A): Promise<R> {
  return runActivityAttempt(1, fn, ...args);
}

export function runActivityAttempt<A extends unknown[], R>(
  attempt: number,
  fn: (...args: A) => Promise<R>,
  ...args: A
): Promise<R> {
  return new MockActivityEnvironment({ attempt }, { logger: quietLogger }).run(fn, ...args);
}

// --- Database ------------------------------------------------------------------------------------

const TABLES = [
  'workflow_events',
  'agent_tasks',
  'payment_mandates',
  'contracts',
  'quotes',
  'vehicle_reservations',
  'credit_checks',
  'leads',
];

/** Empties every table before each test in the calling file. */
export function useCleanDatabase(): void {
  beforeEach(() => {
    const db = getDb();
    for (const table of TABLES) db.prepare(`DELETE FROM ${table}`).run();
  });
}

export const query = <T = Record<string, unknown>>(sql: string, ...params: unknown[]): T[] =>
  getDb().prepare(sql).all(...params) as T[];

export const queryOne = <T = Record<string, unknown>>(sql: string, ...params: unknown[]): T | undefined =>
  getDb().prepare(sql).get(...params) as T | undefined;

/** Rows referenced by foreign keys. */
export function seedLead(leadId = 'lead-1'): string {
  getDb()
    .prepare(
      `INSERT INTO leads (id, first_name, last_name, email, date_of_birth, annual_income, vehicle_model, status)
       VALUES (?, 'Jan', 'Jansen', 'jan@example.com', '1988-05-17', 62000, 'Volvo EX30', 'LEAD_RECEIVED')`,
    )
    .run(leadId);
  return leadId;
}

export function seedQuote(leadId = 'lead-1', quoteId = `${leadId}-quote`): string {
  getDb()
    .prepare(
      `INSERT INTO quotes (id, lead_id, monthly_payment, term_months, annual_km, down_payment, status)
       VALUES (?, ?, 499, 36, 15000, 0, 'SENT')`,
    )
    .run(quoteId, leadId);
  return quoteId;
}

export const auditTrail = (leadId: string) =>
  query<{ step: string; attempt: number; outcome: string; detail: string | null }>(
    'SELECT step, attempt, outcome, detail FROM workflow_events WHERE lead_id = ? ORDER BY id',
    leadId,
  );

// --- HTTP ----------------------------------------------------------------------------------------

export interface RecordedRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: unknown;
}

type Responder = (request: RecordedRequest) => Response | Promise<Response>;

export const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/**
 * Replaces global fetch for every test in the calling file. Answer with `http.respond(...)`
 * (default: 200 {}); inspect what was sent with `http.requests`.
 */
export function useFakeFetch() {
  const realFetch = globalThis.fetch;
  const state = { requests: [] as RecordedRequest[], responder: (() => json(200, {})) as Responder };

  beforeEach(() => {
    state.requests = [];
    state.responder = () => json(200, {});
    globalThis.fetch = (async (input: string | URL | Request, init: RequestInit = {}) => {
      const request: RecordedRequest = {
        method: init.method ?? 'GET',
        url: String(input),
        headers: Object.fromEntries(new Headers(init.headers).entries()),
        body: init.body === undefined ? undefined : JSON.parse(String(init.body)),
      };
      state.requests.push(request);
      return state.responder(request);
    }) as typeof fetch;
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  return {
    get requests() {
      return state.requests;
    },
    get last() {
      return state.requests.at(-1)!;
    },
    respond(responder: Responder | Response) {
      state.responder = responder instanceof Response ? () => responder.clone() : responder;
    },
  };
}
