import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { config } from '../config';

// Small local SQLite database written by the activities as the workflow progresses.
// Every write is an upsert keyed on deterministic ids, because activities can be retried
// (and a retry may run after the previous attempt already wrote its row).

const SCHEMA = `
CREATE TABLE IF NOT EXISTS leads (
  id              TEXT PRIMARY KEY,           -- = Temporal workflow id
  first_name      TEXT NOT NULL,
  last_name       TEXT NOT NULL,
  email           TEXT NOT NULL,
  phone           TEXT,
  date_of_birth   TEXT NOT NULL,
  annual_income   REAL NOT NULL,
  vehicle_model   TEXT NOT NULL,
  status          TEXT NOT NULL,
  status_note     TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS credit_checks (
  lead_id           TEXT PRIMARY KEY REFERENCES leads(id),
  score             INTEGER NOT NULL,
  decision          TEXT NOT NULL,
  bureau_reference  TEXT NOT NULL,
  created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS vehicle_reservations (
  reservation_id  TEXT PRIMARY KEY,
  lead_id         TEXT NOT NULL REFERENCES leads(id),
  vehicle_model   TEXT NOT NULL,
  vin             TEXT NOT NULL,
  list_price      REAL NOT NULL,
  status          TEXT NOT NULL,              -- RESERVED | RELEASED | LEASED
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS quotes (
  id               TEXT PRIMARY KEY,
  lead_id          TEXT NOT NULL REFERENCES leads(id),
  monthly_payment  REAL NOT NULL,
  term_months      INTEGER NOT NULL,
  annual_km        INTEGER NOT NULL,
  down_payment     REAL NOT NULL,
  status           TEXT NOT NULL,             -- SENT | ACCEPTED | DECLINED | EXPIRED
  created_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS contracts (
  id           TEXT PRIMARY KEY,
  lead_id      TEXT NOT NULL REFERENCES leads(id),
  quote_id     TEXT NOT NULL REFERENCES quotes(id),
  envelope_id  TEXT,
  status       TEXT NOT NULL,                 -- DRAFT | SENT_FOR_SIGNATURE | SIGNED | EXPIRED
  signed_at    TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Audit trail: one row per activity attempt, so retries are visible in the database too.
CREATE TABLE IF NOT EXISTS workflow_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id     TEXT NOT NULL,
  step        TEXT NOT NULL,
  attempt     INTEGER NOT NULL,
  outcome     TEXT NOT NULL,                  -- STARTED | SUCCEEDED | FAILED
  detail      TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now'))
);
`;

let db: Database.Database | undefined;

export function getDb(): Database.Database {
  if (!db) {
    mkdirSync(dirname(config.dbPath), { recursive: true });
    db = new Database(config.dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    db.exec(SCHEMA);
  }
  return db;
}
