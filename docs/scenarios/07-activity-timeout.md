# 07 · Hanging inventory

`npm run demo -- timeout` · **Transient**

**What happens**
- The inventory takes 15 s to answer; the limit is 10 s.
- Attempt 1 is abandoned and retried. Attempt 2 is fast → `ACTIVE`.

**Temporal**
- `startToCloseTimeout` bounds **one attempt**. A timeout is just another retryable failure.
- The abandoned attempt may still finish later. That's why the reservation is idempotent per lead.

**How to fix**
- Set the timeout just above the dependency's normal worst case.
- Long-running calls: heartbeat with a `heartbeatTimeout`, so a stuck attempt is detected without
  a long timeout.
- Use `scheduleToCloseTimeout` when the step has a hard business deadline across all attempts.
