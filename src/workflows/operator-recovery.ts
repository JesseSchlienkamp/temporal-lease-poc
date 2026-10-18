import { RetryState } from '@temporalio/common';
import { ActivityFailure, ApplicationFailure, condition, defineUpdate, setHandler } from '@temporalio/workflow';

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

/**
 * Operator decision for a parked step. An update rather than a signal, so the command is rejected
 * (and the caller gets an error) when nothing is waiting for an operator.
 */
export const operatorActionUpdate = defineUpdate<ParkedStep, [OperatorCommand]>('operatorAction');

/**
 * True when the activity gave up only because it ran out of attempts (or time) on retryable
 * errors. Retrying later may then succeed. Non-retryable failures (e.g. HTTP 404) return false:
 * retrying the same input will not help, so those still fail the workflow.
 */
export function canRetryLater(err: unknown): boolean {
  return (
    err instanceof ActivityFailure &&
    (err.retryState === RetryState.MAXIMUM_ATTEMPTS_REACHED || err.retryState === RetryState.TIMEOUT)
  );
}

export function rootCauseMessage(err: unknown): string {
  let current = err;
  while (current instanceof Error && current.cause instanceof Error) current = current.cause;
  return current instanceof Error ? current.message : String(current);
}

interface RecoveryHooks {
  /** Called when a step is parked, e.g. to update status and the database. */
  onPark(parked: ParkedStep): Promise<void>;
  /** Called after the operator has decided, before the step is retried or the workflow aborts. */
  onResume(parked: ParkedStep, command: OperatorCommand): Promise<void>;
}

/**
 * Wraps calls to external systems. When a call exhausts its retry policy, the workflow does not
 * fail: it parks the step and waits (durably, without a timeout) for an operator to send
 * `retry` (run the step again, with a fresh retry policy) or `abort` (fail the workflow, which
 * triggers compensation).
 */
export function createOperatorRecovery(hooks: RecoveryHooks) {
  let parked: ParkedStep | undefined;
  let command: OperatorCommand | undefined;

  setHandler(
    operatorActionUpdate,
    (cmd) => {
      command = cmd;
      return parked!;
    },
    {
      validator: (cmd) => {
        if (!parked) throw new Error('No step is waiting for an operator');
        if (cmd.action !== 'retry' && cmd.action !== 'abort') throw new Error(`Unknown action "${cmd.action}"`);
      },
    },
  );

  /**
   * @param parkOn decides which failures park the step; by default activities that exhausted their
   *               retries on retryable errors.
   */
  async function guard<T>(
    step: string,
    fn: () => Promise<T>,
    { parkOn = canRetryLater }: { parkOn?: (err: unknown) => boolean } = {},
  ): Promise<T> {
    for (;;) {
      try {
        return await fn();
      } catch (err) {
        if (!parkOn(err)) throw err;

        parked = { step, error: rootCauseMessage(err), since: new Date().toISOString() };
        await hooks.onPark(parked);
        await condition(() => command !== undefined);

        const decided = command!;
        const resumed = parked;
        command = undefined;
        parked = undefined;
        await hooks.onResume(resumed, decided);

        if (decided.action === 'abort') {
          throw ApplicationFailure.nonRetryable(
            `Aborted by operator at ${step}${decided.note ? `: ${decided.note}` : ''} (last error: ${resumed.error})`,
            'AbortedByOperator',
          );
        }
        // retry: loop and call fn again
      }
    }
  }

  return { guard, parked: () => parked };
}
