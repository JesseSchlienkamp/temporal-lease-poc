// Workflow registry for the worker (workflowsPath). Every exported function becomes a workflow
// type, so export workflow functions only: messages and types are imported from their own files.
export { carLeaseOnboarding } from './carLeaseOnboarding/carLeaseOnboarding.workflow';
export { contractSigning } from './carLeaseOnboarding/childWorkflows/contractSigning/contractSigning.workflow';
