# 09 · Credit rejected

`npm run demo -- credit-rejected` · **Business outcome**

**What happens**
- The score is below 620 → rejection email → `CREDIT_REJECTED`.

**Temporal**
- The activity succeeds and returns a low score. The workflow branches on it and **completes**.
- Nothing is retried: the call worked, and the answer is no.

**How to fix**
- Nothing to fix. Keep business decisions in the workflow and errors in activities.
- Extend as another path if needed: manual review, a co-signer, a cheaper car.
