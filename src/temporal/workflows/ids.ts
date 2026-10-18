// Deterministic workflow ids, shared by workflows and clients. No runtime imports (workflow sandbox).

/** The contract-signing child workflow of a lead. Fixed, so it can be signalled, queried and reset by id. */
export const signingWorkflowId = (leadId: string): string => `${leadId}-signing`;
