# 11 · Worker crash

`npm run demo -- worker-crash` · **Infrastructure**

**What happens**
- The worker stops while the lead waits for the quote decision.
- The customer accepts while no worker is running. The worker starts again → continues → `ACTIVE`.

**Temporal**
- State lives in the Temporal server's history, not in the worker.
- Signals sent while no worker is running are stored. On restart, the worker replays the history
  and continues where it left off.

**How to fix**
- Nothing to fix in the workflow. Run more than one worker replica for availability.
- Version workflow code (patching) before deploying changes that alter steps of workflows that are
  already running.
