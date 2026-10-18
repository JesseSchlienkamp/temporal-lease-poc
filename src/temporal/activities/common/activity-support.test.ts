import { auditTrail, json, runActivity, runActivityAttempt, seedLead, useCleanDatabase, useFakeFetch } from './testing';
import { ApplicationFailure } from '@temporalio/common';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { callExternal, recordEvent, tracked } from './activity-support';

useCleanDatabase();
const http = useFakeFetch();

describe('recordEvent', () => {
  it('records the attempt number of the running activity', async () => {
    seedLead();
    await runActivityAttempt(3, async () => recordEvent('lead-1', 'step', 'STARTED'));
    assert.deepEqual(auditTrail('lead-1'), [{ step: 'step', attempt: 3, outcome: 'STARTED', detail: null }]);
  });

  it('records attempt 0 outside an activity (e.g. from a script)', () => {
    seedLead();
    recordEvent('lead-1', 'script', 'SUCCEEDED', 'detail');
    assert.deepEqual(auditTrail('lead-1'), [{ step: 'script', attempt: 0, outcome: 'SUCCEEDED', detail: 'detail' }]);
  });
});

describe('tracked', () => {
  it('writes STARTED and SUCCEEDED and returns the result', async () => {
    seedLead();
    const result = await runActivity(() => tracked('lead-1', 'step', () => 42));
    assert.equal(result, 42);
    assert.deepEqual(
      auditTrail('lead-1').map((e) => e.outcome),
      ['STARTED', 'SUCCEEDED'],
    );
  });

  it('writes FAILED with the error message and rethrows', async () => {
    seedLead();
    await assert.rejects(
      runActivityAttempt(2, () =>
        tracked('lead-1', 'step', async () => {
          throw new Error('boom');
        }),
      ),
      /boom/,
    );
    assert.deepEqual(auditTrail('lead-1').at(-1), { step: 'step', attempt: 2, outcome: 'FAILED', detail: 'boom' });
  });

  it('records non-Error throws as a string', async () => {
    seedLead();
    await assert.rejects(
      runActivity(() =>
        tracked('lead-1', 'step', () => {
          throw 'plain string';
        }),
      ),
    );
    assert.equal(auditTrail('lead-1').at(-1)?.detail, 'plain string');
  });
});

describe('callExternal', () => {
  it('sends JSON with an idempotency key and returns the parsed body', async () => {
    http.respond(json(200, { ok: true }));
    const result = await runActivity(() => callExternal('POST', '/thing', { a: 1 }, 'key-1'));
    assert.deepEqual(result, { ok: true });
    assert.deepEqual(http.last, {
      method: 'POST',
      url: 'http://mocks.test/thing',
      headers: { 'content-type': 'application/json', 'idempotency-key': 'key-1' },
      body: { a: 1 },
    });
  });

  it('sends no body and no idempotency key when none are given', async () => {
    await runActivity(() => callExternal('DELETE', '/thing/1'));
    assert.equal(http.last.body, undefined);
    assert.equal(http.last.headers['idempotency-key'], undefined);
  });

  for (const status of [500, 502, 503, 408, 429]) {
    it(`treats HTTP ${status} as retryable`, async () => {
      http.respond(json(status, { error: 'down' }));
      const err = await runActivity(() => callExternal('GET', '/thing')).catch((e: unknown) => e);
      assert.ok(err instanceof ApplicationFailure);
      assert.equal(err.type, 'ExternalServiceUnavailable');
      assert.equal(err.nonRetryable, false);
      assert.match(err.message, new RegExp(`GET /thing -> HTTP ${status}: .*down`));
    });
  }

  for (const status of [400, 404, 409, 422]) {
    it(`treats HTTP ${status} as non-retryable`, async () => {
      http.respond(json(status, { error: 'nope' }));
      const err = await runActivity(() => callExternal('GET', '/thing')).catch((e: unknown) => e);
      assert.ok(err instanceof ApplicationFailure);
      assert.equal(err.type, 'ExternalServiceRejected');
      assert.equal(err.nonRetryable, true);
    });
  }

  it('lets network errors through as plain errors (retryable by default)', async () => {
    http.respond(() => {
      throw new TypeError('fetch failed');
    });
    const err = await runActivity(() => callExternal('GET', '/thing')).catch((e: unknown) => e);
    assert.ok(err instanceof TypeError);
    assert.ok(!(err instanceof ApplicationFailure));
  });
});
