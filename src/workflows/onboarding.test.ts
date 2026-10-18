/**
 * Workflow tests with mocked activities. The time-skipping test server fast-forwards through
 * retry backoffs and multi-day timers, so these run in seconds.
 *
 *   npm test
 */
import { Context } from '@temporalio/activity';
import { WorkflowFailedError } from '@temporalio/client';
import { ApplicationFailure } from '@temporalio/common';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import { Runtime, DefaultLogger, Worker } from '@temporalio/worker';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type * as activities from '../activities';
import type { LeadInput, OnboardingStatus } from '../shared/types';
import { carLeaseOnboarding, contractSignedSignal, quoteDecisionSignal } from './onboarding';

type Activities = typeof activities;

const lead: LeadInput = {
  firstName: 'Jan',
  lastName: 'Jansen',
  email: 'jan@example.com',
  dateOfBirth: '1988-05-17',
  annualIncome: 62_000,
  vehicleModel: 'Volvo EX30',
};

const unavailable = () => ApplicationFailure.retryable('HTTP 503 (mocked)', 'ExternalServiceUnavailable');

/** Happy-path activity mocks that record every call (and its attempt number). */
function mockActivities(overrides: Partial<Activities> = {}) {
  const calls: { name: string; attempt: number }[] = [];
  const statuses: OnboardingStatus[] = [];
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
      workflowsPath: require.resolve('./index'),
      activities: acts,
    });
    return worker.runUntil(fn(taskQueue));
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
      await handle.signal(contractSignedSignal, { signedAt: '2026-10-16T12:00:00Z' });
      return handle.result();
    });

    assert.equal(result.status, 'ACTIVE');
    assert.deepEqual(
      mock.callsTo('runCreditCheck').map((c) => c.attempt),
      [1, 2, 3],
    );
  });

  it('gives up after max attempts when a service stays down, and releases nothing it did not reserve', async () => {
    const mock = mockActivities({
      runCreditCheck: async () => {
        throw unavailable();
      },
    });

    await assert.rejects(
      run(mock.activities, (taskQueue) =>
        env.client.workflow.execute(carLeaseOnboarding, { taskQueue, workflowId: `lead-down-${n}`, args: [lead] }),
      ),
      WorkflowFailedError,
    );
    assert.equal(mock.callsTo('runCreditCheck').length, 10); // maximumAttempts
    assert.equal(mock.callsTo('releaseVehicle').length, 0);
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
});
