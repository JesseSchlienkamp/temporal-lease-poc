// Types shared by all activities.

/** One row in the workflow_events audit table (written by activities, one per attempt). */
export type AuditOutcome = 'STARTED' | 'SUCCEEDED' | 'FAILED';
