import { auditTrail, json, runActivity, seedLead, useCleanDatabase, useFakeFetch } from '../common/testing';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { sendEmail } from './sendEmail.activity';

useCleanDatabase();
const http = useFakeFetch();

describe('sendEmail', () => {
  it('posts the email, keyed by lead and template', async () => {
    seedLead();
    await runActivity(sendEmail, 'lead-1', 'jan@example.com', 'quote', { monthlyPayment: 499 });
    assert.equal(http.last.url, 'http://mocks.test/notifications/email');
    assert.equal(http.last.headers['idempotency-key'], 'lead-1:quote');
    assert.deepEqual(http.last.body, { to: 'jan@example.com', template: 'quote', data: { monthlyPayment: 499 } });
    assert.equal(auditTrail('lead-1')[0]?.step, 'sendEmail:quote');
  });

  it('sends empty data by default', async () => {
    seedLead();
    await runActivity(sendEmail, 'lead-1', 'jan@example.com', 'welcome');
    assert.deepEqual(http.last.body, { to: 'jan@example.com', template: 'welcome', data: {} });
  });

  it('fails retryably when the notification service is down', async () => {
    seedLead();
    http.respond(json(503, { error: 'down' }));
    await assert.rejects(runActivity(sendEmail, 'lead-1', 'jan@example.com', 'welcome'), /HTTP 503/);
  });
});
