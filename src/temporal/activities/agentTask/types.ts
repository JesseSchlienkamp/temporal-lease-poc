// Agent task domain: work items for human agents (agent_tasks table).

export type AgentTaskType = 'COLLECT_IBAN';

/** Returned when a task is opened: shows up in the Temporal UI as the activity result. */
export interface AgentTaskLink {
  taskId: string;
  /** Opens the agent inbox scrolled to this task. */
  url: string;
}
