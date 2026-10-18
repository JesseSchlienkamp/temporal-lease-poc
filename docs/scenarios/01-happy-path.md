# 01 · Happy path

`npm run demo -- happy` · **Transient**

**What happens**
- The credit bureau fails the first 2 calls (503); inventory and email fail now and then.
- The IBAN is valid, the customer accepts and signs → `ACTIVE`.

**Temporal**
- Activity retry policy: exponential backoff (1 s, 2 s, 4 s … max 30 s), up to 10 attempts.
- The workflow code has no retry logic; failed attempts only show up in the history.

**How to fix**
- Nothing to fix. This is the default for flaky dependencies.
- Make activities idempotent (upserts, idempotency keys) so a retry is always safe.
