# 08 · Unknown vehicle model

`npm run demo -- unknown-model` · **Wrong data**

**What happens**
- The lead asks for a "Fiat Multipla". The inventory returns 404.
- No retries: the workflow fails at once, and the lead is `FAILED`.

**Temporal**
- 4xx → `ApplicationFailure.nonRetryable`: retrying the **same input** can't succeed.
- A **reset doesn't help**: it replays the original input, so the same 404 comes back.

**How to fix**
- Today: correct the data and start a new lead.
  - The credit check runs again.
  - Don't reuse the old lead ID: `saveLead` won't overwrite the old row.
- Recommended:
  1. **Validate at the door.** `POST /leads` checks the model against the catalogue → 400.
  2. **Make it correctable in the workflow** for cases detected later (e.g. a model discontinued):
     - catch the 404 and open a "correct vehicle model" agent form (the 404 lists the valid models);
     - the update validator only accepts catalogue models;
     - the workflow retries the reservation with the corrected value.

     The credit check isn't repeated, the lead keeps its ID, and the history records the correction.
