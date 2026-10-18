# 04 · Customer declines the quote

`npm run demo -- decline` · **Business outcome**

**What happens**
- The customer declines → the reserved car is released → `QUOTE_DECLINED`.

**Temporal**
- The decision arrives as a **signal**. The wait has a timeout (7 days → `QUOTE_EXPIRED`).
- Saga: compensations are registered as steps succeed and run in reverse when the lead stops.
- The workflow **completes**; a decline is a result, not an error.

**How to fix**
- Nothing to fix. Model expected outcomes as return values, not exceptions.
