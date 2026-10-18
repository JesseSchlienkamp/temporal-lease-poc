// Types shared by all workflows. Type-only: safe to import inside the workflow sandbox.

export type OperatorAction = 'retry' | 'abort';

export interface OperatorCommand {
  action: OperatorAction;
  note?: string;
}

/** A step that ran out of retries and is waiting for an operator. */
export interface ParkedStep {
  step: string;
  error: string;
  since: string;
}

export interface RecoveryHooks {
  /** Called when a step is parked, e.g. to update status and the database. */
  onPark(parked: ParkedStep): Promise<void>;
  /** Called after the operator has decided, before the step is retried or the workflow aborts. */
  onResume(parked: ParkedStep, command: OperatorCommand): Promise<void>;
}

export interface GuardOptions {
  /** Which failures park the step. Default: activities that exhausted their retries on retryable errors. */
  parkOn?: (err: unknown) => boolean;
}
