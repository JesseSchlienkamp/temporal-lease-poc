# 05 · E-sign outage

`npm run demo -- esign-outage` · **Outage**

**What happens**
- The e-sign provider returns 502. After 3 attempts the signing child **fails**.
- The parent parks as `NEEDS_ATTENTION`, and the car stays reserved.
- Fix the provider, `retry` → a new child run → `ACTIVE`. `abort` → car released, `FAILED`.

**Temporal**
- A short retry policy on this one call (3 attempts) makes the failure explicit.
- A **child workflow** isolates the failure. The parent catches `ChildWorkflowFailure` and waits
  for an operator **update**.
- Retry starts a new child run under the same ID. The credit check and reservation don't run
  again, and the verified IBAN is reused.

**How to fix**
- Operational: restore the provider, then `POST /leads/:id/operator {"action":"retry"}`.
- Don't let the parent fail as well: it would release the car, and a reset of either workflow can't
  bring that back.
