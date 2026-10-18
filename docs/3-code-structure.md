# 3 · Code structure

## Principles

- **Temporal code is in one place.** Everything Temporal-specific lives in `src/temporal/`. The
  rest of `src/` is ordinary application code (API, database, mocks, demo) that calls into it.
- **Workflows by business process, activities by system.** `workflows/` has one flat folder per
  process. `activities/` has one folder per domain, and any workflow can use any activity.
- **Dependencies point one way.** Activities never import from `workflows/`. A child workflow never
  imports from its parent. Clients import a workflow's `messages.ts` and `types.ts`, never its code.

## Layout

```
src/
  temporal/
    worker.ts                                registers workflows + activities, polls the task queue
    connection.ts                            connection settings: local, Temporal Cloud (API key), TLS
    workflows/
      index.ts                               workflow registry (the worker's workflowsPath)
      ids.ts                                 deterministic workflow IDs, e.g. <leadId>-signing
      common/
        activity-options.ts                  retry policies and timeouts
        operator-recovery.ts                 recovery.guard: park a step that ran out of retries
        messages.ts · types.ts               operatorAction update, OperatorCommand, ParkedStep
      carLeaseOnboarding/
        carLeaseOnboarding.workflow.ts       the parent workflow
        carLeaseOnboarding.workflow.test.ts  workflow tests (time-skipping test server)
        messages.ts                          quoteDecision signal, getState query
        types.ts                             input, options, state
      contractSigning/
        contractSigning.workflow.ts          the child workflow
        messages.ts                          contractSigned, getSigningState, submitPaymentDetails
        types.ts                             input, result, state, agent form
    activities/
      index.ts                               activity registry: one named export per activity
      common/
        activity-support.ts                  tracked() audit rows, callExternal() error classification
        testing.ts                           test helpers: in-memory SQLite, fake fetch, mock context
      lead/          saveLead · updateLeadStatus · qualifyLead
      credit/        runCreditCheck
      vehicle/       reserveVehicle · releaseVehicle
      quote/         createQuote · updateQuoteStatus
      lease/         activateLease
      notification/  sendEmail
      contract/      createContract · requestSignature · expireContract
      payment/       verifyBankAccount · findPaymentMandate · savePaymentMandate
      agentTask/     openAgentTask · completeAgentTask (+ agentTaskId.ts helper)
  api/               server.ts (endpoints) · agent-page.ts (agent inbox)
  db/                database.ts: schema, created on first use
  mock-services/     server.ts (fake systems + chaos admin) · types.ts
  shared/            iban.ts · names.ts: pure, also safe inside the workflow sandbox
  demo/              index.ts (menu) · scenarios.ts · runtime.ts · types.ts
  scripts/           start-onboarding · show-db · reset-workflow · chaos
  config.ts          environment settings
```

## Naming

| File | Contains |
|---|---|
| `<name>.workflow.ts` | one workflow function, with its activity proxies declared above it |
| `<name>.activity.ts` | one activity function, plus private helpers that only it uses |
| `<name>.*.test.ts` | the tests for that file, next to it |
| `messages.ts` | a workflow's signals, queries and updates |
| `types.ts` | the types of that folder: a workflow's input and state, or a domain's activity payloads |

## Two registries

The worker loads two indexes:
- **`workflows/index.ts`:** every exported function becomes a workflow type, so export workflow
  functions only.
- **`activities/index.ts`:** every export becomes an activity, so it uses explicit named exports.
  Helpers like `agentTaskId` or `testing.ts` are never listed there.

Activity names are global on the task queue, so they must be unique across domains.

## Adding an activity

1. Create `src/temporal/activities/<domain>/<name>.activity.ts`:
   - wrap the body in `tracked(leadId, '<name>', …)` to get audit rows;
   - use `callExternal` for HTTP calls, so errors are classified consistently;
   - make it idempotent: use upserts and pass an idempotency key.
2. Put its argument and result types in `<domain>/types.ts`.
3. Export it from `activities/index.ts`.
4. Call it from a workflow through `local` (database), `external` (third party) or a proxy with its
   own options.
5. Add `<name>.activity.test.ts`, using the helpers in `activities/common/testing.ts`.

## Adding a workflow

1. Create `src/temporal/workflows/<name>/` with `<name>.workflow.ts`, `messages.ts` and `types.ts`.
2. Declare its activity proxies above the function, with options from `common/activity-options.ts`.
3. Export the function from `workflows/index.ts`.
4. Start it from a client by name, with a type-only import:
   `client.workflow.start<typeof name>('name', …)`. Or start it from another workflow with
   `startChild`.
5. Test it the way `carLeaseOnboarding.workflow.test.ts` does: mocked activities on the
   time-skipping test server.

---
Next: [4 · Development →](4-development.md)
