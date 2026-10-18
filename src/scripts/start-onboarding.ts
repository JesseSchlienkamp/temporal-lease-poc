/**
 * Starts an onboarding workflow from the command line.
 *
 *   npm run lead                                  # start, then accept + sign by hand via the API
 *   npm run lead -- --auto                        # also accept the quote and sign automatically
 *   npm run lead -- --auto --decline              # customer declines -> reservation is released
 *   npm run lead -- --model "Fiat Multipla"       # unknown model -> non-retryable failure
 *   npm run lead -- --email jan+reject@example.com  # low credit score -> CREDIT_REJECTED
 */
import { Client } from '@temporalio/client';
import { randomUUID } from 'node:crypto';
import { parseArgs } from 'node:util';
import { config } from '../config';
import type { LeadInput, OnboardingStatus } from '../shared/types';
import { connectClient } from '../temporal-connection';
import { carLeaseOnboarding, contractSignedSignal, getStateQuery, quoteDecisionSignal } from '../workflows';

const { values: args } = parseArgs({
  options: {
    first: { type: 'string', default: 'Jan' },
    last: { type: 'string', default: 'Jansen' },
    email: { type: 'string', default: 'jan.jansen@example.com' },
    dob: { type: 'string', default: '1988-05-17' },
    income: { type: 'string', default: '62000' },
    model: { type: 'string', default: 'Volvo EX30' },
    auto: { type: 'boolean', default: false },
    decline: { type: 'boolean', default: false },
  },
});

async function main() {
  const client = new Client({ connection: await connectClient(), namespace: config.temporal.namespace });

  const lead: LeadInput = {
    firstName: args.first,
    lastName: args.last,
    email: args.email,
    dateOfBirth: args.dob,
    annualIncome: Number(args.income),
    vehicleModel: args.model,
  };
  const leadId = `lead-${randomUUID().slice(0, 8)}`;
  const handle = await client.workflow.start(carLeaseOnboarding, {
    taskQueue: config.taskQueue,
    workflowId: leadId,
    args: [lead, { quoteDecisionTimeout: '10 minutes', signatureTimeout: '10 minutes' }],
  });
  console.log(`Started ${leadId}  ->  http://localhost:8233/namespaces/${config.temporal.namespace}/workflows/${leadId}`);

  if (!args.auto) {
    console.log(`\nNext steps (API on :${config.apiPort}):`);
    console.log(`  curl localhost:${config.apiPort}/leads/${leadId}`);
    console.log(`  curl -X POST localhost:${config.apiPort}/leads/${leadId}/quote-decision -H 'content-type: application/json' -d '{"accepted":true}'`);
    console.log(`  curl -X POST localhost:${config.apiPort}/leads/${leadId}/sign`);
    return;
  }

  // Auto mode: play the customer.
  let last: OnboardingStatus | undefined;
  const signalled = new Set<OnboardingStatus>();
  for (;;) {
    const { status } = await handle.describe();
    if (status.name !== 'RUNNING') break;

    const state = await handle.query(getStateQuery);
    if (state.status !== last) console.log(`  status: ${(last = state.status)}`);

    if (state.status === 'QUOTE_SENT' && !signalled.has('QUOTE_SENT')) {
      signalled.add('QUOTE_SENT');
      await handle.signal(quoteDecisionSignal, { accepted: !args.decline, reason: args.decline ? 'Too expensive' : undefined });
    }
    if (state.status === 'AWAITING_SIGNATURE' && !signalled.has('AWAITING_SIGNATURE')) {
      signalled.add('AWAITING_SIGNATURE');
      await handle.signal(contractSignedSignal, { signedAt: new Date().toISOString(), signerName: `${lead.firstName} ${lead.lastName}` });
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  try {
    const result = await handle.result();
    console.log(`\nFinished with status ${result.status}`);
    console.table(result.history);
  } catch (err) {
    let cause = err as Error;
    while (cause.cause instanceof Error) cause = cause.cause;
    console.error(`\nWorkflow failed: ${cause.message}`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
