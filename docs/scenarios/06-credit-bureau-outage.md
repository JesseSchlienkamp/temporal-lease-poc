# 06 · Credit bureau outage

`npm run demo -- credit-outage` · **Transient → Outage**

**What happens**
- The credit bureau returns 503 on every call.
- If it comes back mid-way → the next attempt succeeds, with no human involved.
- If it stays down for all 10 attempts (~2.5 min) → `NEEDS_ATTENTION` → fix → `retry`.

**Temporal**
- Backoff keeps growing up to 30 s between attempts.
- When the retries run out (`MAXIMUM_ATTEMPTS_REACHED`), `recovery.guard` parks the step instead of
  failing, and waits for an operator **update**.
- `retry` runs the step again with a fresh retry policy.

**How to fix**
- Short outages: nothing; the retry policy absorbs them.
- Long outages: alert on the attempt count or on `NEEDS_ATTENTION`, restore the service, retry.
- Tune `maximumAttempts` and `maximumInterval` to how long the business can wait.
