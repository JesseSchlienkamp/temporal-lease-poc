# 03 · Application IBAN rejected

`npm run demo -- application-iban-rejected` · **Wrong data**

**What happens**
- The application contains someone else's IBAN. The bank check returns `NO_MATCH`.
- The same agent form opens, with the bank's reason → corrected → `ACTIVE`.

**Temporal**
- The same loop as 02. The customer's value and the agent's value go through the same checks.

**How to fix**
- Already handled in the workflow.
- Architecture: check the IBAN at the door (format and checksum in the application form) so fewer
  leads need an agent.
