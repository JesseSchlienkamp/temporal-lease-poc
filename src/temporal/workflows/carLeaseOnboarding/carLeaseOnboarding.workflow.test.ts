/**
 * Workflow tests with mocked activities. The time-skipping test server fast-forwards through
 * retry backoffs and multi-day timers, so these run in seconds.
 *
 *   npm test
 */
import { Context } from '@temporalio/activity';
import { WorkflowFailedError, WorkflowNotFoundError, WorkflowUpdateFailedError } from '@temporalio/client';
import { ApplicationFailure } from '@temporalio/common';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import { Runtime, DefaultLogger, Worker } from '@temporalio/worker';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { signingWorkflowId } from '../ids';
import type * as activities from '../../activities';
import { operatorActionUpdate } from '../common/messages';
import { contractSignedSignal, getSigningStateQuery, submitPaymentDetailsUpdate } from '../contractSigning/messages';
import type { SigningState } from '../contractSigning/types';
import type { PaymentMandate } from '../../activities/payment/types';
import { getStateQuery, quoteDecisionSignal } from './messages';
import type { LeadInput, OnboardingStatus } from './types';
import { carLeaseOnboarding } from './carLeaseOnboarding.workflow';

type Activities = typeof activities;

const lead: LeadInput = {
  firstName: 'Jan',
  lastName: 'Jansen',
  email: 'jan@example.com',
  dateOfBirth: '1988-05-17',
  annualIncome: 62_000,
  vehicleModel: 'Volvo EX30',
  iban: 'NL91ABNA0417164300',
};

const unavailable = () => ApplicationFailure.retryable('HTTP 503 (mocked)', 'ExternalServiceUnavailable');

/** Happy-path activity mocks that record every call (and its attempt number). */
function mockActivities(overrides: Partial<Activities> = {}) {
  const calls: { name: string; attempt: number }[] = [];
  const statuses: OnboardingStatus[] = [];
  let savedMandate: PaymentMandate | null = null; // like the payment_mandates table
  const happy: Activities = {
    saveLead: async () => {},
    updateLeadStatus: async (_id, status) => {
      statuses.push(status);
    },
    qualifyLead: async () => ({ qualified: true }),
    runCreditCheck: async () => ({ score: 720, decision: 'APPROVED', bureauReference: 'CB-1' }),
    reserveVehicle: async () => ({ reservationId: 'RES-1', vin: 'VIN1', vehicleModel: lead.vehicleModel, listPrice: 40_000 }),
    releaseVehicle: async () => {},
    createQuote: async () => ({ quoteId: 'Q-1', monthlyPayment: 499, termMonths: 36, annualKm: 15_000, downPayment: 0 }),
    updateQuoteStatus: async () => {},
    createContract: async () => ({ contractId: 'C-1' }),
    requestSignature: async () => ({ contractId: 'C-1', envelopeId: 'ENV-1', signingUrl: 'https://sign' }),
    expireContract: async () => {},
    activateLease: async () => {},
    sendEmail: async () => {},
    verifyBankAccount: async () => ({ result: 'MATCH', registeredName: 'J. Jansen' }),
    savePaymentMandate: async (_id, details) => (savedMandate = { mandateReference: 'MANDATE-1', ...details }),
    findPaymentMandate: async () => savedMandate,
    openAgentTask: async () => {},
    completeAgentTask: async () => {},
  };
  const merged = { ...happy, ...overrides };
  const tracked = Object.fromEntries(
    Object.entries(merged).map(([name, fn]) => [
      name,
      (...args: unknown[]) => {
        calls.push({ name, attempt: Context.current().info.attempt });
        return (fn as (...a: unknown[]) => unknown)(...args);
      },
    ]),
  ) as unknown as Activities;
  const callsTo = (name: keyof Activities) => calls.filter((c) => c.name === name);
  return { activities: tracked, callsTo, statuses };
}

describe('carLeaseOnboarding', () => {
  let env: TestWorkflowEnvironment;
  let n = 0;

  before(async () => {
    Runtime.install({ logger: new DefaultLogger('WARN') });
    env = await TestWorkflowEnvironment.createTimeSkipping();
  });
  after(async () => {
    await env?.teardown();
  });

  async function run<T>(acts: Activities, fn: (taskQueue: string) => Promise<T>): Promise<T> {
    const taskQueue = `test-${++n}`;
    const worker = await Worker.create({
      connection: env.nativeConnection,
      taskQueue,
      workflowsPath: require.resolve('..'),
      activities: acts,
    });
    return worker.runUntil(fn(taskQueue));
  }

  /** The signing child only exists once the parent reaches that step; wait for it, then sign. */
  async function signWhenChildStarts(leadId: string): Promise<void> {
    const child = env.client.workflow.getHandle(signingWorkflowId(leadId));
    for (let i = 0; i < 100; i++) {
      try {
        await child.signal(contractSignedSignal, { signedAt: '2026-10-16T12:00:00Z' });
        return;
      } catch (err) {
        if (!(err instanceof WorkflowNotFoundError)) throw err;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
    throw new Error(`Signing child of ${leadId} never started`);
  }

  /** Polls the signing child's state until `predicate` holds (the child may not exist yet). */
  async function waitForSigning(leadId: string, predicate: (state: SigningState) => boolean): Promise<SigningState> {
    const child = env.client.workflow.getHandle(signingWorkflowId(leadId));
    for (let i = 0; i < 100; i++) {
      try {
        const state = await child.query(getSigningStateQuery);
        if (predicate(state)) return state;
      } catch (err) {
        if (!(err instanceof WorkflowNotFoundError)) throw err;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`Signing child of ${leadId} never reached the expected state`);
  }

  it('retries a flaky credit bureau and still reaches ACTIVE', async () => {
    let failuresLeft = 2;
    const mock = mockActivities({
      runCreditCheck: async () => {
        if (failuresLeft-- > 0) throw unavailable();
        return { score: 720, decision: 'APPROVED', bureauReference: 'CB-1' };
      },
    });

    const result = await run(mock.activities, async (taskQueue) => {
      const handle = await env.client.workflow.start(carLeaseOnboarding, {
        taskQueue,
        workflowId: `lead-flaky-${n}`,
        args: [lead],
      });
      // Signals are buffered until the workflow gets to the point where it waits for them.
      await handle.signal(quoteDecisionSignal, { accepted: true });
      await signWhenChildStarts(handle.workflowId);
      return handle.result();
    });

    assert.equal(result.status, 'ACTIVE');
    assert.equal(result.signingWorkflowId, `lead-flaky-${n}-signing`);
    assert.equal(result.mandate?.iban, lead.iban);
    assert.equal(mock.callsTo('openAgentTask').length, 0); // valid IBAN in the application: no agent needed
    assert.equal(mock.callsTo('activateLease').length, 1);
    assert.deepEqual(
      mock.callsTo('runCreditCheck').map((c) => c.attempt),
      [1, 2, 3],
    );
  });

  it('parks a step that stays down after max attempts, and resumes it on operator retry', async () => {
    let down = true;
    const mock = mockActivities({
      runCreditCheck: async () => {
        if (down) throw unavailable();
        return { score: 720, decision: 'APPROVED', bureauReference: 'CB-1' };
      },
    });

    const result = await run(mock.activities, async (taskQueue) => {
      const handle = await env.client.workflow.start(carLeaseOnboarding, {
        taskQueue,
        workflowId: `lead-down-${n}`,
        args: [lead],
      });
      await handle.signal(quoteDecisionSignal, { accepted: true });

      // Nothing is parked yet: the update validator rejects the command.
      await assert.rejects(
        handle.executeUpdate(operatorActionUpdate, { args: [{ action: 'retry' }] }),
        WorkflowUpdateFailedError,
      );

      await env.sleep('10 minutes'); // fast-forward through the backoff of all 10 attempts
      const parked = await handle.query(getStateQuery);
      assert.equal(parked.status, 'NEEDS_ATTENTION');
      assert.equal(parked.needsAttention?.step, 'runCreditCheck');
      assert.equal(mock.callsTo('runCreditCheck').length, 10); // maximumAttempts

      down = false; // the operator fixed the cause
      await handle.executeUpdate(operatorActionUpdate, { args: [{ action: 'retry', note: 'bureau is back' }] });
      await signWhenChildStarts(handle.workflowId);
      return handle.result();
    });

    assert.equal(result.status, 'ACTIVE');
    assert.equal(result.needsAttention, undefined);
    assert.equal(mock.callsTo('runCreditCheck').length, 11);
    assert.ok(mock.statuses.includes('NEEDS_ATTENTION'));
  });

  it('fails and compensates when the operator aborts a parked step', async () => {
    const mock = mockActivities({
      sendEmail: async (_leadId, _to, template) => {
        if (template === 'quote') throw unavailable();
      },
    });

    const failure = await run(mock.activities, async (taskQueue) => {
      const handle = await env.client.workflow.start(carLeaseOnboarding, {
        taskQueue,
        workflowId: `lead-abort-${n}`,
        args: [lead],
      });
      await env.sleep('10 minutes');
      assert.equal((await handle.query(getStateQuery)).needsAttention?.step, 'sendEmail:quote');

      await handle.executeUpdate(operatorActionUpdate, { args: [{ action: 'abort', note: 'email provider down' }] });
      return handle.result().then(
        () => assert.fail('expected the workflow to fail'),
        (err: unknown) => err,
      );
    });

    assert.ok(failure instanceof WorkflowFailedError);
    assert.match(String(failure.cause?.message), /Aborted by operator at sendEmail:quote: email provider down/);
    assert.equal(mock.callsTo('releaseVehicle').length, 1); // the vehicle was already reserved
    assert.equal(mock.statuses.at(-1), 'FAILED');
  });

  it('does not retry non-retryable failures (unknown vehicle model)', async () => {
    const mock = mockActivities({
      reserveVehicle: async () => {
        throw ApplicationFailure.nonRetryable('HTTP 404 Unknown vehicle model', 'ExternalServiceRejected');
      },
    });

    await assert.rejects(
      run(mock.activities, (taskQueue) =>
        env.client.workflow.execute(carLeaseOnboarding, { taskQueue, workflowId: `lead-404-${n}`, args: [lead] }),
      ),
      WorkflowFailedError,
    );
    assert.equal(mock.callsTo('reserveVehicle').length, 1);
    assert.equal(mock.statuses.at(-1), 'FAILED');
  });

  it('expires the quote after 7 days and releases the reserved vehicle (compensation)', async () => {
    const mock = mockActivities();

    const result = await run(mock.activities, (taskQueue) =>
      // No signal is sent; the time-skipping server jumps over the 7-day timer.
      env.client.workflow.execute(carLeaseOnboarding, { taskQueue, workflowId: `lead-expire-${n}`, args: [lead] }),
    );

    assert.equal(result.status, 'QUOTE_EXPIRED');
    assert.equal(mock.callsTo('releaseVehicle').length, 1);
  });

  it('runs signing as a child workflow; an expired signature releases the vehicle', async () => {
    const mock = mockActivities();

    const result = await run(mock.activities, async (taskQueue) => {
      const handle = await env.client.workflow.start(carLeaseOnboarding, {
        taskQueue,
        workflowId: `lead-unsigned-${n}`,
        args: [lead],
      });
      await handle.signal(quoteDecisionSignal, { accepted: true });
      // Never sign: the time-skipping server jumps over the child's 14-day timer.
      return handle.result();
    });

    assert.equal(result.status, 'SIGNATURE_EXPIRED');
    assert.equal(mock.callsTo('requestSignature').length, 1);
    assert.equal(mock.callsTo('expireContract').length, 1);
    assert.equal(mock.callsTo('releaseVehicle').length, 1);
    assert.equal(mock.callsTo('activateLease').length, 0);
  });

  it('opens an agent form when the IBAN is missing, and reopens it until a valid one is submitted', async () => {
    const mock = mockActivities({
      verifyBankAccount: async (_id, details) =>
        details.iban === 'NL20INGB0001234567'
          ? { result: 'NO_MATCH', registeredName: 'P. de Vries' }
          : { result: 'MATCH', registeredName: 'J. Jansen' },
    });
    const submit = (leadId: string, iban: string, accountHolder: string) =>
      env.client.workflow
        .getHandle(signingWorkflowId(leadId))
        .executeUpdate(submitPaymentDetailsUpdate, { args: [{ iban, accountHolder }] });

    const result = await run(mock.activities, async (taskQueue) => {
      const handle = await env.client.workflow.start(carLeaseOnboarding, {
        taskQueue,
        workflowId: `lead-agent-${n}`,
        args: [{ ...lead, iban: undefined }],
      });
      await handle.signal(quoteDecisionSignal, { accepted: true });
      const leadId = handle.workflowId;

      const opened = await waitForSigning(leadId, (s) => s.stage === 'AWAITING_AGENT');
      assert.equal(opened.agentForm?.reason, 'No IBAN in the application');
      assert.equal(opened.agentForm?.prefill.accountHolder, 'Jan Jansen');

      // 1. Typo in the IBAN: rejected by the update validator, never reaches the workflow
      await assert.rejects(submit(leadId, 'NL00ABNA0417164300', 'Jan Jansen'), WorkflowUpdateFailedError);

      // 2. Account in someone else's name: rejected by the workflow's policy check, form reopened
      const otherHolder = await submit(leadId, 'NL20INGB0001234567', 'P. de Vries');
      assert.equal(otherHolder.accepted, false);
      assert.match(otherHolder.accepted ? '' : otherHolder.reason, /customer's name/);

      // 3. Bank says the IBAN belongs to someone else: rejected, form reopened again
      const noMatch = await submit(leadId, 'NL20INGB0001234567', 'Jan Jansen');
      assert.deepEqual(noMatch, {
        accepted: false,
        reason: 'Bank: NL20 INGB 0001 2345 67 is registered to "P. de Vries", not "Jan Jansen"',
        rejectedSubmissions: 2,
      });
      const reopened = await waitForSigning(leadId, (s) => s.stage === 'AWAITING_AGENT');
      assert.equal(reopened.agentForm?.rejectedSubmissions, 2);

      // 4. Correct IBAN (any formatting): accepted, the workflow continues
      const accepted = await submit(leadId, 'nl91 abna 0417 1643 00', 'Jan Jansen');
      assert.equal(accepted.accepted, true);
      assert.equal(accepted.accepted && accepted.mandate.iban, 'NL91ABNA0417164300');

      await waitForSigning(leadId, (s) => s.stage === 'AWAITING_SIGNATURE');
      await signWhenChildStarts(leadId);
      return handle.result();
    });

    assert.equal(result.status, 'ACTIVE');
    assert.equal(result.mandate?.iban, 'NL91ABNA0417164300');
    assert.equal(mock.callsTo('openAgentTask').length, 3); // opened + reopened twice
    assert.equal(mock.callsTo('verifyBankAccount').length, 2); // the policy rejection never calls the bank
    assert.equal(mock.callsTo('completeAgentTask').length, 1);
    assert.equal(mock.callsTo('requestSignature').length, 1); // only after a valid IBAN
  });

  it('opens the agent form when the IBAN from the application fails verification', async () => {
    const mock = mockActivities({
      verifyBankAccount: async () => ({ result: 'ACCOUNT_CLOSED', registeredName: 'J. Jansen' }),
    });

    await run(mock.activities, async (taskQueue) => {
      const handle = await env.client.workflow.start(carLeaseOnboarding, {
        taskQueue,
        workflowId: `lead-closed-${n}`,
        args: [{ ...lead, iban: 'NL44RABO0123456789' }],
      });
      await handle.signal(quoteDecisionSignal, { accepted: true });

      const opened = await waitForSigning(handle.workflowId, (s) => s.stage === 'AWAITING_AGENT');
      assert.equal(opened.agentForm?.reason, 'IBAN from the application was rejected. Bank: NL44 RABO 0123 4567 89 is closed');
      assert.equal(opened.agentForm?.prefill.iban, 'NL44RABO0123456789');
      await handle.terminate('test done');
    });
    assert.equal(mock.callsTo('requestSignature').length, 0);
  });

  it('fails the signing child after 3 e-sign errors; the parent keeps the car and retries signing', async () => {
    let esignDown = true;
    const badGateway = () => ApplicationFailure.retryable('HTTP 502 (mocked)', 'ExternalServiceUnavailable');
    const mock = mockActivities({
      requestSignature: async () => {
        if (esignDown) throw badGateway();
        return { contractId: 'C-1', envelopeId: 'ENV-1', signingUrl: 'https://sign' };
      },
    });

    const result = await run(mock.activities, async (taskQueue) => {
      const handle = await env.client.workflow.start(carLeaseOnboarding, {
        taskQueue,
        workflowId: `lead-esign-${n}`,
        args: [lead],
      });
      await handle.signal(quoteDecisionSignal, { accepted: true });
      const child = env.client.workflow.getHandle(signingWorkflowId(handle.workflowId));

      await env.sleep('1 minute'); // fast-forward through the e-sign backoff (1s, 2s)
      const parked = await handle.query(getStateQuery);
      assert.equal(parked.status, 'NEEDS_ATTENTION');
      assert.equal(parked.needsAttention?.step, 'contractSigning');
      assert.match(parked.needsAttention!.error, /HTTP 502/);
      assert.equal((await child.describe()).status.name, 'FAILED');
      assert.equal(mock.callsTo('requestSignature').length, 3);
      assert.equal(mock.callsTo('releaseVehicle').length, 0); // the car stays reserved while parked

      esignDown = false; // the provider is back
      await handle.executeUpdate(operatorActionUpdate, { args: [{ action: 'retry' }] });
      await waitForSigning(handle.workflowId, (s) => s.stage === 'AWAITING_SIGNATURE');
      await signWhenChildStarts(handle.workflowId);
      return handle.result();
    });

    assert.equal(result.status, 'ACTIVE');
    assert.equal(mock.callsTo('requestSignature').length, 4);
    assert.equal(mock.callsTo('createContract').length, 2); // one per child run (idempotent)
    assert.equal(mock.callsTo('verifyBankAccount').length, 1); // the retry reuses the verified mandate
    assert.equal(mock.callsTo('runCreditCheck').length, 1);
    assert.equal(mock.callsTo('reserveVehicle').length, 1);
    assert.equal(mock.callsTo('releaseVehicle').length, 0);
  });

  it('releases the car when the operator aborts a failed signing', async () => {
    const mock = mockActivities({
      requestSignature: async () => {
        throw ApplicationFailure.retryable('HTTP 502 (mocked)', 'ExternalServiceUnavailable');
      },
    });

    await assert.rejects(
      run(mock.activities, async (taskQueue) => {
        const handle = await env.client.workflow.start(carLeaseOnboarding, {
          taskQueue,
          workflowId: `lead-esign-abort-${n}`,
          args: [lead],
        });
        await handle.signal(quoteDecisionSignal, { accepted: true });
        await env.sleep('1 minute');
        assert.equal((await handle.query(getStateQuery)).needsAttention?.step, 'contractSigning');
        await handle.executeUpdate(operatorActionUpdate, { args: [{ action: 'abort', note: 'provider outage' }] });
        return handle.result();
      }),
      WorkflowFailedError,
    );
    assert.equal(mock.callsTo('releaseVehicle').length, 1);
    assert.equal(mock.statuses.at(-1), 'FAILED');
  });
});
