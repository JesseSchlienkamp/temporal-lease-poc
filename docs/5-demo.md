# 5 · Demo

## Demo CLI

```bash
npm run demo                          # interactive menu of every scenario
npm run demo -- esign-outage          # run one scenario directly
npm run demo -- esign-outage --yes    # no prompts: every question takes its default answer
npm run demo -- --list                # scenario ids
```

**What a run looks like:**
1. The demo first checks that Temporal, the worker, the mocks and the API are up, and tells you
   what to start if something is missing.
2. Picking a scenario shows what to expect.
3. The demo starts a lead and plays the customer (accepting the quote, signing). It stops wherever
   a person is needed.
4. Each run ends with a summary: final status, timeline, retries and re-runs per step (from the
   Temporal history), every workflow run, and links to the UI and `db:show`.

The mock services are reset before and after every scenario, and on Ctrl+C.

| Group | Scenario | You do |
|---|---|---|
| Happy path | Happy path | nothing; watch the retries |
| Human in the loop | Missing IBAN → agent form | submit IBANs from the terminal or at `/agent` |
| | Application IBAN fails verification | the same form, opened with the bank's reason |
| | Customer declines the quote | nothing; the car is released |
| Failure & recovery | E-sign outage → child fails → fix and retry | choose: fix + retry, retry, or abort |
| | Credit bureau outage → retries → operator | recover mid-way, or after ~2.5 min |
| | Hanging inventory → activity timeout | nothing; watch the 10 s timeout |
| | Unknown vehicle model → non-retryable | nothing; it fails fast |
| | Credit rejected (business outcome) | nothing |
| Temporal power tools | Reset only the signing child | confirm the reset |
| | Worker crash while waiting | stop and restart the worker |

Each scenario is written up in [scenarios](scenarios/README.md): what happens, how Temporal is
involved, and how to resolve it.

## Where retries show up

- **The Temporal UI**: the *Pending activities* panel with the attempt number and last error, and
  the history once an attempt succeeds.
- **The mock-services log** (`npm run dev:mocks`): every call, and whether a failure was injected.
- **The `workflow_events` table** (`npm run db:show -- <leadId>`): one row per activity attempt.

## Without the demo CLI

`npm run lead` starts a single lead from a script:

```bash
npm run lead -- --auto                                 # happy path; --auto plays the customer
npm run lead -- --auto --scenario agent-form           # no IBAN → agent form
npm run lead -- --auto --iban NL20INGB0001234567       # IBAN that fails the bank check
npm run lead -- --auto --scenario esign-outage         # e-sign down; prints the fix-and-retry commands
npm run lead -- --auto --decline                       # customer declines → car released
npm run lead -- --auto --model "Fiat Multipla"         # unknown model → non-retryable failure
npm run lead -- --auto --email jan+reject@example.com  # low credit score → CREDIT_REJECTED
npm run lead                                           # start only; continue by hand with the API
```

### Walkthrough: e-sign outage by hand

1. `npm run chaos -- esign down`, then start a lead and accept the quote.
2. The e-sign call fails 3 times with 502. The `<leadId>-signing` child **fails**, and the UI
   shows it in red.
3. The parent goes to `NEEDS_ATTENTION`, step `contractSigning`. The car stays reserved.
4. Fix the provider, then retry:
   ```bash
   npm run chaos -- esign up
   curl -X POST localhost:3000/leads/<leadId>/operator \
        -H 'content-type: application/json' -d '{"action":"retry"}'
   ```
5. A **new run** of the child starts under the same ID, reuses the verified IBAN and sends the
   contract. `POST /leads/<leadId>/sign` then completes the lease. `{"action":"abort"}` would fail
   the lead and release the car instead.

### Walkthrough: reset only the child

1. Start a lead with `npm run lead` and accept the quote.
2. Wait until `GET /leads/<leadId>` shows `signing.stage: AWAITING_SIGNATURE`.
3. Run `npm run reset -- <leadId>-signing`. The child's old run is terminated, and a new run creates
   the contract and sends it again (both steps are idempotent). The parent keeps waiting.
4. `POST /leads/<leadId>/sign` completes the lease.

## Demo data

**IBANs known to the mock bank.** They're also listed on the agent page. Any other well-formed IBAN
is "not found".

| IBAN | Bank record |
|---|---|
| `NL91 ABNA 0417 1643 00` | J. Jansen: matches the demo customer |
| `NL20 INGB 0001 2345 67` | P. de Vries |
| `NL44 RABO 0123 4567 89` | J. Jansen, account closed |
| `NL51 ABNA 0987 6543 21` | P. Bakker |
| `NL00 ABNA 0417 1643 00` | invalid checksum: the validator rejects it |

**Vehicle models:** `Volvo EX30`, `Tesla Model 3`, `Kia EV6`, `Volkswagen ID.4`, `BMW i4`,
`Skoda Enyaq`. Any other model gets a 404.

**Credit score:** an email address containing `reject` gets a score below 620.

---
Next: [Scenarios →](scenarios/README.md)
