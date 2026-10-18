import express, { type RequestHandler } from 'express';
import { createHash, randomUUID } from 'node:crypto';
import { config } from '../config';
import { normalizeIban } from '../shared/iban';
import { namesMatch } from '../shared/names';

/**
 * Stand-ins for the external systems the onboarding depends on, with configurable failures so
 * Temporal's retries can be demonstrated:
 *
 *   failFirstN   fail the first N calls per idempotency key (deterministic, great for demos)
 *   failureRate  probability (0..1) that any call fails
 *   latencyMs    delay before responding; > 10000 makes the activity time out and retry
 *   errorStatus  HTTP status returned for injected failures (5xx = retryable)
 *
 * Inspect / change at runtime:  GET /admin/chaos   POST /admin/chaos   POST /admin/chaos/reset
 */

type ServiceName = 'creditBureau' | 'inventory' | 'esign' | 'notifications' | 'bank';
interface Chaos {
  failFirstN: number;
  failureRate: number;
  latencyMs: number;
  errorStatus: number;
}

const DEFAULT_CHAOS: Record<ServiceName, Chaos> = {
  creditBureau: { failFirstN: 2, failureRate: 0, latencyMs: 300, errorStatus: 503 },
  inventory: { failFirstN: 0, failureRate: 0.3, latencyMs: 800, errorStatus: 500 },
  esign: { failFirstN: 1, failureRate: 0, latencyMs: 200, errorStatus: 502 },
  notifications: { failFirstN: 0, failureRate: 0.2, latencyMs: 100, errorStatus: 503 },
  bank: { failFirstN: 0, failureRate: 0, latencyMs: 300, errorStatus: 503 },
};

const chaos: Record<ServiceName, Chaos> = structuredClone(DEFAULT_CHAOS);
applyOverrides(process.env.MOCK_CHAOS ? JSON.parse(process.env.MOCK_CHAOS) : {});

const callCounts = new Map<string, number>();

function applyOverrides(overrides: Partial<Record<ServiceName, Partial<Chaos>>>) {
  for (const [name, values] of Object.entries(overrides)) {
    if (!(name in chaos)) throw new Error(`Unknown service "${name}". Known: ${Object.keys(chaos).join(', ')}`);
    Object.assign(chaos[name as ServiceName], values);
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Middleware that injects latency and failures according to the service's chaos settings. */
function withChaos(service: ServiceName): RequestHandler {
  return async (req, res, next) => {
    const settings = chaos[service];
    const key = `${service}:${req.header('idempotency-key') ?? req.path}`;
    const call = (callCounts.get(key) ?? 0) + 1;
    callCounts.set(key, call);

    if (settings.latencyMs > 0) await sleep(settings.latencyMs);

    const injectFailure = call <= settings.failFirstN || Math.random() < settings.failureRate;
    const tag = `[${service}] ${req.method} ${req.path} call #${call}`;
    if (injectFailure) {
      console.log(`${tag} -> injected HTTP ${settings.errorStatus}`);
      res.status(settings.errorStatus).json({ error: `${service} temporarily unavailable (injected failure)` });
      return;
    }
    console.log(`${tag} -> OK`);
    next();
  };
}

// --- Fake data -------------------------------------------------------------------------------------
const VEHICLES: Record<string, number> = {
  'Volvo EX30': 38_995,
  'Tesla Model 3': 42_990,
  'Kia EV6': 49_995,
  'Volkswagen ID.4': 44_990,
  'BMW i4': 59_900,
  'Skoda Enyaq': 46_490,
};

// The bank's records for the IBAN-name check. Any other valid IBAN is NOT_FOUND.
const BANK_ACCOUNTS: Record<string, { holder: string; closed?: boolean }> = {
  NL91ABNA0417164300: { holder: 'J. Jansen' },
  NL20INGB0001234567: { holder: 'P. de Vries' },
  NL44RABO0123456789: { holder: 'J. Jansen', closed: true },
  NL51ABNA0987654321: { holder: 'P. Bakker' },
};

const reservations = new Map<string, { reservationId: string; vin: string; vehicleModel: string; listPrice: number }>();

const hashInt = (value: string, mod: number) => parseInt(createHash('sha256').update(value).digest('hex').slice(0, 8), 16) % mod;

// --- App -------------------------------------------------------------------------------------------
const app = express();
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

app.post('/credit-bureau/score', withChaos('creditBureau'), (req, res) => {
  const { email = '' } = req.body as { email?: string };
  // Deterministic per applicant; use an email containing "reject" to force a low score.
  const score = email.includes('reject') ? 540 + hashInt(email, 60) : 640 + hashInt(email, 180);
  res.json({ score, reference: `CB-${hashInt(email, 1_000_000).toString().padStart(6, '0')}` });
});

app.post('/inventory/reservations', withChaos('inventory'), (req, res) => {
  const { leadId, vehicleModel } = req.body as { leadId: string; vehicleModel: string };
  const listPrice = VEHICLES[vehicleModel];
  if (listPrice === undefined) {
    // 4xx -> the activity throws a non-retryable failure
    res.status(404).json({ error: `Unknown vehicle model "${vehicleModel}"`, available: Object.keys(VEHICLES) });
    return;
  }
  // Idempotent: a retried reservation for the same lead returns the same reservation.
  const existing = reservations.get(leadId);
  if (existing) {
    res.json(existing);
    return;
  }
  const reservation = {
    reservationId: `RES-${randomUUID().slice(0, 8)}`,
    vin: `YV1${randomUUID().replace(/-/g, '').slice(0, 14).toUpperCase()}`,
    vehicleModel,
    listPrice,
  };
  reservations.set(leadId, reservation);
  res.status(201).json(reservation);
});

app.delete('/inventory/reservations/:id', withChaos('inventory'), (req, res) => {
  for (const [leadId, r] of reservations) if (r.reservationId === req.params.id) reservations.delete(leadId);
  res.json({ released: req.params.id });
});

app.post('/esign/envelopes', withChaos('esign'), (req, res) => {
  const { contractId } = req.body as { contractId: string };
  const envelopeId = `ENV-${hashInt(contractId, 1_000_000)}`;
  res.status(201).json({ envelopeId, signingUrl: `https://esign.example.com/sign/${envelopeId}` });
});

app.post('/bank/account-check', withChaos('bank'), (req, res) => {
  const { iban, accountHolder } = req.body as { iban: string; accountHolder: string };
  const account = BANK_ACCOUNTS[normalizeIban(iban)];
  if (!account) {
    res.json({ result: 'NOT_FOUND' });
    return;
  }
  const result = account.closed ? 'ACCOUNT_CLOSED' : namesMatch(account.holder, accountHolder) ? 'MATCH' : 'NO_MATCH';
  res.json({ result, registeredName: account.holder });
});

app.post('/notifications/email', withChaos('notifications'), (req, res) => {
  const { to, template } = req.body as { to: string; template: string };
  console.log(`[notifications] 📧 "${template}" -> ${to}`);
  res.status(202).json({ messageId: randomUUID() });
});

// --- Chaos admin -----------------------------------------------------------------------------------
app.get('/admin/chaos', (_req, res) => {
  res.json(chaos);
});

/** Body: partial settings, e.g. { "creditBureau": { "failFirstN": 5 }, "inventory": { "latencyMs": 15000 } } */
app.post('/admin/chaos', (req, res) => {
  try {
    applyOverrides(req.body);
    res.json(chaos);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

/** Restores the defaults and clears the per-key call counters. */
app.post('/admin/chaos/reset', (_req, res) => {
  Object.assign(chaos, structuredClone(DEFAULT_CHAOS));
  callCounts.clear();
  res.json(chaos);
});

app.listen(config.mockPort, () => {
  console.log(`Mock external services listening on http://localhost:${config.mockPort}`);
  console.log('Chaos settings:', JSON.stringify(chaos));
});
