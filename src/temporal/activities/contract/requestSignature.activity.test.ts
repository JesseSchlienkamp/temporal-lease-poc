import { json, queryOne, runActivity, seedLead, seedQuote, useCleanDatabase, useFakeFetch } from '../common/testing';
import { getDb } from '../../../db/database';
import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { requestSignature } from './requestSignature.activity';

useCleanDatabase();
const http = useFakeFetch();

beforeEach(() => {
  seedLead();
  getDb().prepare(`INSERT INTO contracts (id, lead_id, quote_id, status) VALUES ('C-1', 'lead-1', ?, 'DRAFT')`).run(seedQuote());
});

describe('requestSignature', () => {
  it('creates an envelope, keyed by contract, and marks the contract SENT_FOR_SIGNATURE', async () => {
    http.respond(json(201, { envelopeId: 'ENV-1', signingUrl: 'https://sign/ENV-1' }));
    assert.deepEqual(await runActivity(requestSignature, 'lead-1', 'C-1', 'jan@example.com'), {
      contractId: 'C-1',
      envelopeId: 'ENV-1',
      signingUrl: 'https://sign/ENV-1',
    });
    assert.equal(http.last.url, 'http://mocks.test/esign/envelopes');
    assert.equal(http.last.headers['idempotency-key'], 'C-1');
    assert.deepEqual(http.last.body, { contractId: 'C-1', signerEmail: 'jan@example.com' });
    assert.deepEqual(queryOne('SELECT envelope_id, status FROM contracts'), { envelope_id: 'ENV-1', status: 'SENT_FOR_SIGNATURE' });
  });

  it('leaves the contract untouched when the provider returns 502', async () => {
    http.respond(json(502, { error: 'down' }));
    await assert.rejects(runActivity(requestSignature, 'lead-1', 'C-1', 'jan@example.com'), /HTTP 502/);
    assert.deepEqual(queryOne('SELECT envelope_id, status FROM contracts'), { envelope_id: null, status: 'DRAFT' });
  });
});
