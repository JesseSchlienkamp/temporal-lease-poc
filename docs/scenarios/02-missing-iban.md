# 02 · Missing IBAN → agent form

`npm run demo -- agent-form` · **Wrong data**

**What happens**
- The application has no IBAN. The signing child opens an agent form and waits.
- A wrong submission is rejected and the form reopens. A verified IBAN → mandate → contract → `ACTIVE`.

**Temporal**
- The workflow waits durably (no timeout) with `condition()`.
- The form submit is a workflow **update**:
  - the validator rejects malformed input before it reaches the history;
  - the handler returns the workflow's verdict to the agent synchronously.
- Two layers of checks: format and checksum in the validator, then name and bank check in the workflow.

**How to fix**
- Already handled: the person with the right data supplies it, and the workflow continues.
- At scale: list open forms through a custom search attribute instead of querying every workflow.
