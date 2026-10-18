/** Prints the local SQLite database. Pass a lead id to filter: npm run db:show -- lead-1234abcd */
import { getDb } from '../db/database';

const leadId = process.argv[2];
const db = getDb();

const tables: [string, string][] = [
  ['leads', 'id'],
  ['credit_checks', 'lead_id'],
  ['vehicle_reservations', 'lead_id'],
  ['quotes', 'lead_id'],
  ['contracts', 'lead_id'],
  ['payment_mandates', 'lead_id'],
  ['agent_tasks', 'lead_id'],
  ['workflow_events', 'lead_id'],
];

for (const [table, leadColumn] of tables) {
  const rows = leadId
    ? db.prepare(`SELECT * FROM ${table} WHERE ${leadColumn} = ? ORDER BY rowid`).all(leadId)
    : db.prepare(`SELECT * FROM ${table} ORDER BY rowid DESC LIMIT 25`).all();
  console.log(`\n== ${table} (${rows.length}) ==`);
  if (rows.length) console.table(rows);
}
