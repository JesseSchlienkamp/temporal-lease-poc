# Scenarios

Each test path from `npm run demo`, written down: what happens, how Temporal is involved, and how
to resolve it.

## Dealing with failures

Sort every error by **who can fix it**. That decides what the workflow should do. Only a code bug
needs a reset: a reset replays the original input, so it can't fix bad data.

| Error | Example | Who fixes it | Workflow behaviour |
|---|---|---|---|
| Transient | 5xx, timeout | time | retry automatically |
| Outage | service down for longer than the retries cover | operator | park, then retry or abort |
| Wrong data | 404 unknown model, invalid IBAN | a person with the right data | form, then continue with the corrected value |
| Business outcome | car out of stock, credit rejected | the business rules | another path: offer an alternative, decline |
| Bug | wrong code | developer | deploy the fix, then reset |

## Scenarios

| # | Scenario | Type |
|---|---|---|
| 01 | [Happy path](01-happy-path.md) | Transient |
| 02 | [Missing IBAN → agent form](02-missing-iban.md) | Wrong data |
| 03 | [Application IBAN rejected](03-application-iban-rejected.md) | Wrong data |
| 04 | [Customer declines the quote](04-quote-declined.md) | Business outcome |
| 05 | [E-sign outage](05-esign-outage.md) | Outage |
| 06 | [Credit bureau outage](06-credit-bureau-outage.md) | Transient → Outage |
| 07 | [Hanging inventory](07-activity-timeout.md) | Transient |
| 08 | [Unknown vehicle model](08-unknown-vehicle-model.md) | Wrong data |
| 09 | [Credit rejected](09-credit-rejected.md) | Business outcome |
| 10 | [Reset the signing child](10-reset-child.md) | Bug (tooling) |
| 11 | [Worker crash](11-worker-crash.md) | Infrastructure |

---
Next: [6 · Deployment →](../6-deployment.md) · Back to the [README](../../README.md)
