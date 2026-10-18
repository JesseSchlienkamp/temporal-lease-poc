# 10 · Reset the signing child

`npm run demo -- reset-child` · **Bug (tooling)**

**What happens**
- While the signing child waits for the signature, it is reset to its first workflow task.
- The old run is terminated, and a new run creates the contract and sends it again. Sign → `ACTIVE`.

**Temporal**
- **Reset** starts a new run from a point in history with the original input. Signals after that
  point are re-applied.
- The parent follows the child's new run because it tracks the child by workflow ID.
- Only the child's steps run twice; the parent's history is untouched.

**How to fix**
- Use this for bugs: deploy the fix, then reset the affected workflows (`npm run reset -- <id>`).
- Steps after the reset point must be idempotent.
- Only works while the parent is still waiting. Once a child has failed and the parent has seen
  that failure, start a new child run instead (see 05).
