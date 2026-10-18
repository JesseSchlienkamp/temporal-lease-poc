# Car-lease onboarding: a Temporal PoC (TypeScript)

This PoC takes a car-lease customer from **lead** to **active leasing contract**: credit check,
vehicle reservation, quote, contract, IBAN, e-signature. It's built on [Temporal](https://temporal.io)
to show what Temporal adds to a process like this:
- calls to unreliable systems are retried automatically;
- waiting for days on a customer costs nothing;
- a crash loses nothing;
- people can step in when something needs a human.

The external systems are mocks you can make fail on purpose.

## Temporal in one table

Temporal runs your business process as ordinary code and **records every step** in its server. If
a process crashes, it continues exactly where it was. That only works if the process code is split
in two:
- **Workflows** decide what happens next. This code is replayed from the history, so it must be
  deterministic: no I/O, no randomness.
- **Activities** do the actual work: HTTP calls, database writes, email.

| Temporal concept | What it is | In this repo |
|---|---|---|
| **Temporal Service** | Server that stores every workflow's history and hands out work. Includes the web UI. | `npm run temporal` (local dev server, UI on :8233) |
| **Workflow** | The process logic. Durable: it survives crashes and can wait for days. | `src/temporal/workflows/carLeaseOnboarding/` |
| **Child workflow** | A workflow started by another workflow, with its own history. | `src/temporal/workflows/contractSigning/` |
| **Activity** | One step with side effects. Retried automatically when it fails. | `src/temporal/activities/<domain>/<name>.activity.ts` |
| **Worker** | Your process that runs the workflow and activity code. Temporal never runs your code itself. | `src/temporal/worker.ts` |
| **Task queue** | The named queue a worker polls for work. | `car-lease-onboarding` |
| **Retry policy / timeouts** | How often and how fast a failing activity is retried. | `src/temporal/workflows/common/activity-options.ts` |
| **Signal · Query · Update** | Talk to a running workflow: send an event, read its state, or send a validated request with a reply. | `messages.ts` next to each workflow |
| **Client** | Code that starts workflows and sends them messages. | `src/api/server.ts`, `src/demo/`, `src/scripts/` |

## Repo map

```
src/
  temporal/        ← everything Temporal: workflows, activities, worker, connection
  api/             HTTP API + agent inbox page (a Temporal client)
  db/              SQLite schema (the activities write to it)
  mock-services/   fake credit bureau, inventory, e-sign, email and bank, with failure switches
  shared/          small pure helpers (IBAN, names)
  demo/            interactive demo CLI
  scripts/         small CLIs: start a lead, show the database, reset a workflow, switch mocks
docs/              documentation, read in order (below)
infra/             Azure Container Apps (Bicep)
```

## Quick start

Prerequisites: Node 22+ and the Temporal CLI (`brew install temporal`).

```bash
npm install
npm run temporal    # terminal 1: Temporal dev server, UI on http://localhost:8233
npm run dev         # terminal 2: worker + API (:3000) + mock services (:8081)
npm run demo        # terminal 3: pick a scenario and watch it run
```

Open http://localhost:8233 next to the demo to see each workflow, its history and its retries.
`npm test` runs the tests.

## Read next

The docs go from general to specific:

1. [How Temporal works here](docs/1-how-temporal-works-here.md): one lead, followed through the
   system, and the rules a Temporal codebase must follow
2. [The onboarding process](docs/2-onboarding-process.md): steps, statuses, compensation, failure
   strategy, operator recovery, agent form
3. [Code structure](docs/3-code-structure.md): where things live, and how to add an activity or a workflow
4. [Development](docs/4-development.md): running locally, configuration, API, mock services, tests
5. [Demo](docs/5-demo.md): the demo CLI and manual walkthroughs
6. [Scenarios](docs/scenarios/README.md): every test path in detail, with how to resolve it
7. [Deployment](docs/6-deployment.md): Azure Container Apps, Temporal Cloud, PoC limitations
