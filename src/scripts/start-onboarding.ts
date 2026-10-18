/**
 * Starts an onboarding workflow from the command line.
 *
 *   npm run lead                                  # start, then accept + sign by hand via the API
 *   npm run lead -- --auto                        # also accept the quote and sign automatically
 *
 * Scenarios (combine with --auto):
 *   --scenario happy        (default) valid IBAN in the application, runs straight through
 *   --scenario agent-form   no IBAN: the signing child opens a form at http://localhost:3000/agent
 *   --scenario esign-outage switches the mock e-sign provider down first: the signing child fails
 *                           after 3 x 502; switch it back up and retry the signing (instructions printed)
 *   --iban <value>          use this IBAN instead, e.g. NL20INGB0001234567 (someone else's -> form)
 *
 *   npm run lead -- --auto --decline              # customer declines -> reservation is released
 *   npm run lead -- --model "Fiat Multipla"       # unknown model -> non-retryable failure
 *   npm run lead -- --email jan+reject@example.com  # low credit score -> CREDIT_REJECTED
 */
import { Client } from '@temporalio/client';
import { randomUUID } from 'node:crypto';
import { parseArgs } from 'node:util';
import { config } from '../config';
import { signingWorkflowId } from '../temporal/workflows/ids';
import { connectClient } from '../temporal/connection';
import { getStateQuery, quoteDecisionSignal } from '../temporal/workflows/carLeaseOnboarding/messages';
import type { OnboardingStatus } from '../temporal/workflows/carLeaseOnboarding/types';
import type { LeadInput } from '../temporal/activities/lead/types';
import type { carLeaseOnboarding } from '../temporal/workflows/carLeaseOnboarding/carLeaseOnboarding.workflow';
import { contractSignedSignal, getSigningStateQuery } from '../temporal/workflows/contractSigning/messages';
import type { SigningStage } from '../temporal/workflows/contractSigning/types';

const SCENARIOS = {
  happy: { iban: 'NL91ABNA0417164300' },
  'agent-form': { iban: undefined },
  'esign-outage': { iban: 'NL91ABNA0417164300', esignDown: true },
} as const;
type Scenario = keyof typeof SCENARIOS;

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
    scenario: { type: 'string', default: 'happy' },
    iban: { type: 'string' },
  },
});

if (!(args.scenario in SCENARIOS)) {
  console.error(`Unknown scenario "${args.scenario}". Known: ${Object.keys(SCENARIOS).join(', ')}`);
  process.exit(1);
}
const scenario: { iban?: string; esignDown?: boolean } = SCENARIOS[args.scenario as Scenario];

async function main() {
  const client = new Client({ connection: await connectClient(), namespace: config.temporal.namespace });

  const lead: LeadInput = {
    firstName: args.first,
    lastName: args.last,
    email: args.email,
    dateOfBirth: args.dob,
    annualIncome: Number(args.income),
    vehicleModel: args.model,
    iban: args.iban ?? scenario.iban,
  };
  if (scenario.esignDown) {
    const res = await fetch(`${config.mockServicesUrl}/admin/chaos`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ esign: { failureRate: 1, failFirstN: 0 } }),
    });
    if (!res.ok) throw new Error(`Could not switch the e-sign mock down: HTTP ${res.status}`);
    console.log('E-sign provider switched DOWN (every call returns 502)');
  }

  const leadId = `lead-${randomUUID().slice(0, 8)}`;
  const handle = await client.workflow.start<typeof carLeaseOnboarding>('carLeaseOnboarding', {
    taskQueue: config.taskQueue,
    workflowId: leadId,
    args: [lead, { quoteDecisionTimeout: '10 minutes', signatureTimeout: '10 minutes' }],
  });
  console.log(`Scenario ${args.scenario}${lead.iban ? `, IBAN ${lead.iban}` : ', no IBAN'}`);
  console.log(`Started ${leadId}  ->  http://localhost:8233/namespaces/${config.temporal.namespace}/workflows/${leadId}`);

  if (!args.auto) {
    console.log(`\nNext steps (API on :${config.apiPort}):`);
    console.log(`  curl localhost:${config.apiPort}/leads/${leadId}`);
    console.log(`  curl -X POST localhost:${config.apiPort}/leads/${leadId}/quote-decision -H 'content-type: application/json' -d '{"accepted":true}'`);
    console.log(`  curl -X POST localhost:${config.apiPort}/leads/${leadId}/sign`);
    return;
  }

  // Auto mode: play the customer.
  let last: string | undefined;
  const signalled = new Set<OnboardingStatus | SigningStage>();
  const child = client.workflow.getHandle(signingWorkflowId(leadId));
  for (;;) {
    const { status } = await handle.describe();
    if (status.name !== 'RUNNING') break;

    const state = await handle.query(getStateQuery);
    const signing = state.signingWorkflowId ? await child.query(getSigningStateQuery) : undefined;
    const current = signing ? `${state.status} / signing: ${signing.stage}` : state.status;
    if (current !== last) {
      console.log(`  status: ${(last = current)}`);
      if (signing?.stage === 'AWAITING_AGENT') {
        console.log(`    ↳ ${signing.agentForm?.reason}. Waiting for an agent: ${signing.agentForm?.url ?? `http://localhost:${config.apiPort}/agent`}`);
      }
      if (state.needsAttention) {
        console.log(`    ↳ ${state.needsAttention.step} failed: ${state.needsAttention.error}`);
        console.log(`    ↳ fix it, then retry (or send "abort"):`);
        if (state.needsAttention.step === 'contractSigning') console.log(`        npm run chaos -- esign up`);
        console.log(
          `        curl -X POST localhost:${config.apiPort}/leads/${leadId}/operator -H 'content-type: application/json' -d '{"action":"retry"}'`,
        );
      }
    }

    if (state.status === 'QUOTE_SENT' && !signalled.has('QUOTE_SENT')) {
      signalled.add('QUOTE_SENT');
      await handle.signal(quoteDecisionSignal, { accepted: !args.decline, reason: args.decline ? 'Too expensive' : undefined });
    }
    if (signing?.stage === 'AWAITING_SIGNATURE' && !signalled.has('AWAITING_SIGNATURE')) {
      signalled.add('AWAITING_SIGNATURE');
      await child.signal(contractSignedSignal, {
        signedAt: new Date().toISOString(),
        signerName: `${lead.firstName} ${lead.lastName}`,
      });
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
