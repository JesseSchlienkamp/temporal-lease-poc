import type { AgentTaskType } from './types';

export const agentTaskId = (workflowId: string, type: AgentTaskType) => `${workflowId}:${type}`;
