# 4 · Development

## Running locally

Prerequisites: Node 22+ and the Temporal CLI (`brew install temporal`).

```bash
npm install
cp .env.example .env    # optional: the defaults work locally
npm run temporal        # Temporal dev server; history is kept in data/temporal.db
npm run dev             # worker + API + mock services, in one terminal
```

To watch each process in its own terminal:

| Command | Runs | Logs |
|---|---|---|
| `npm run dev:worker` | the worker | every workflow and activity, including retries |
| `npm run dev:api` | the API + agent page on :3000 | requests |
| `npm run dev:mocks` | the mock services on :8081 | every call and every injected failure |
| `npm run dev:api-server` | the API and the mocks together | both, labelled |

Two terminals are enough: `dev:worker` in one, `dev:api-server` in the other. All `dev:*` commands
restart when a file changes.

**Restart the worker after changing workflow code.** Workflows that are still running are replayed
with the new code. If the new code makes different calls in a different order, they get stuck on a
non-determinism error (see [rule 4](1-how-temporal-works-here.md#the-rules)). In this PoC,
terminate them:

```bash
temporal workflow terminate --query "ExecutionStatus='Running'" --reason "code change" --yes
```

To run everything in containers instead: `docker compose up --build`.

## Configuration

Set these in `.env` locally (see `.env.example`), or as container environment variables in Azure.

| Variable | Default | Purpose |
|---|---|---|
| `TEMPORAL_ADDRESS` | `localhost:7233` | Temporal Service endpoint |
| `TEMPORAL_NAMESPACE` | `default` | namespace |
| `TEMPORAL_API_KEY` | | Temporal Cloud API key; switches TLS on |
| `TEMPORAL_TLS` | `false` | TLS without an API key |
| `TASK_QUEUE` | `car-lease-onboarding` | task queue for the worker and clients |
| `DB_PATH` | `./data/leasing.db` | SQLite file (`:memory:` in tests) |
| `MOCK_SERVICES_URL` | `http://localhost:8081` | where activities find the external systems |
| `MOCK_PORT` | `8081` | port of the mock services |
| `MOCK_CHAOS` | | JSON override of the default failure settings |
| `PORT` | `3000` | API port |
| `AGENT_PAGE_URL` | `http://localhost:<PORT>/agent` | base URL of the agent task links |

## npm scripts

| Script | Does |
|---|---|
| `temporal` | starts the Temporal dev server (UI on :8233) |
| `dev`, `dev:*` | run the worker, API and mocks; see above |
| `demo` | interactive demo CLI; see [Demo](5-demo.md) |
| `lead` | starts one onboarding from the command line (`--auto` plays the customer) |
| `db:show` | prints the SQLite tables; pass a lead ID to filter: `npm run db:show -- lead-1a2b3c4d` |
| `reset` | resets a workflow to its first workflow task: `npm run reset -- <workflowId>` |
| `chaos` | shows or switches the mock services: `npm run chaos -- esign down` / `up` / `reset` |
| `test`, `test:coverage` | tests; see below |
| `typecheck`, `build` | `tsc` without and with output to `dist/` |

## API

| Endpoint | Temporal | Does |
|---|---|---|
| `POST /leads` | start workflow | start an onboarding; returns `{ leadId }` |
| `GET /leads/:id` | queries `getState`, `getSigningState` | live state of the lead and its signing child |
| `POST /leads/:id/quote-decision` | signal `quoteDecision` | `{ "accepted": true }` |
| `POST /leads/:id/sign` | signal `contractSigned` (child) | simulates the e-sign webhook |
| `POST /leads/:id/operator` | update `operatorAction` | `{ "action": "retry" \| "abort" }`; 409 when nothing is parked |
| `GET /agent` | | agent inbox page; `?task=<workflowId>` opens one task |
| `GET /agent/tasks` | list + query | open agent forms |
| `POST /agent/tasks/:workflowId/payment-details` | update `submitPaymentDetails` | `{ iban, accountHolder }`; 422 when the validator rejects it |
| `GET /health` | | health check |

```bash
curl -X POST localhost:3000/leads -H 'content-type: application/json' -d '{
  "firstName": "Jan", "lastName": "Jansen", "email": "jan@example.com",
  "dateOfBirth": "1988-05-17", "annualIncome": 62000, "vehicleModel": "Volvo EX30",
  "iban": "NL91ABNA0417164300",
  "options": { "quoteDecisionTimeout": "5 minutes" }
}'
```

## Mock services

`src/mock-services/server.ts` stands in for the credit bureau, inventory, e-sign provider, email
service and bank. Each one can be made to fail:

| Setting | Effect |
|---|---|
| `failFirstN` | fail the first N calls per idempotency key (deterministic) |
| `failureRate` | probability (0–1) that any call fails |
| `latencyMs` | delay before answering; above 10 000 the activity times out |
| `errorStatus` | HTTP status of injected failures |

Defaults: the credit bureau fails the first 2 calls per lead, the inventory fails 30% of calls,
email fails 20%, and e-sign and the bank don't fail.

```bash
npm run chaos                          # current settings
npm run chaos -- creditBureau down     # every call fails
npm run chaos -- reset                 # defaults
curl -X POST localhost:8081/admin/chaos -H 'content-type: application/json' \
     -d '{"inventory": {"latencyMs": 15000}}'      # any setting, per service
```

## Database

SQLite at `DB_PATH`. The schema in `src/db/database.ts` is created on first use.

| Table | Written by |
|---|---|
| `leads` | `saveLead`, `updateLeadStatus` |
| `credit_checks` | `runCreditCheck` |
| `vehicle_reservations` | `reserveVehicle`, `releaseVehicle`, `activateLease` |
| `quotes` | `createQuote`, `updateQuoteStatus`, `activateLease` |
| `contracts` | `createContract`, `requestSignature`, `expireContract`, `activateLease` |
| `payment_mandates` | `savePaymentMandate` |
| `agent_tasks` | `openAgentTask`, `completeAgentTask` |
| `workflow_events` | every activity: one row per attempt (`STARTED` / `SUCCEEDED` / `FAILED`) |

## Tests and coverage

```bash
npm test                # ~80 tests: activities + workflows
npm run test:coverage   # plus a coverage report (terminal + coverage/index.html); fails below 95%
```

- **Workflow tests** (`carLeaseOnboarding.workflow.test.ts`) run both workflows on Temporal's
  **time-skipping** test server. The activities are mocked and fail on purpose, and days of
  timers pass in milliseconds. They cover retries, parking with retry or abort, the non-retryable
  path, timeouts with compensation, the agent-form loop and the e-sign outage.
- **Activity tests** (`<name>.activity.test.ts`) run each activity in Temporal's
  `MockActivityEnvironment`, with an in-memory SQLite and a fake `fetch`. The helpers are in
  `src/temporal/activities/common/testing.ts`.
- **Coverage** has two sources, merged into one report:
  - **activities:** c8;
  - **workflows:** `@temporalio/nyc-test-coverage`, because workflow code runs in Temporal's sandbox
    where ordinary coverage tools can't see it.

  Branches aren't enforced: c8 reports phantom branches in the activity files. Those come from the
  CommonJS wrapper that `tsx` (esbuild) generates. The workflow branch figures are accurate.

---
Next: [5 · Demo →](5-demo.md)
