import * as p from '@clack/prompts';
import { WorkflowUpdateFailedError } from '@temporalio/client';
import pc from 'picocolors';
import { spawn } from 'node:child_process';
import { resetToFirstWorkflowTask } from '../scripts/reset-workflow';
import { formatIban } from '../shared/iban';
import {
  getSigningStateQuery,
  operatorActionUpdate,
  quoteDecisionSignal,
  submitPaymentDetailsUpdate,
  type SigningState,
} from '../workflows';
import {
  API_URL,
  chaos,
  chaosReset,
  choose,
  cmd,
  demoLead,
  follow,
  kv,
  pressEnter,
  sleep,
  startLead,
  type DemoContext,
  type FollowHooks,
  type FollowResult,
  type Lead,
  truncate,
} from './runtime';

export interface Scenario {
  id: string;
  group: string;
  title: string;
  hint: string;
  duration: string;
  expect: string[];
  run(ctx: DemoContext): Promise<FollowResult>;
}

// --- Shared interactive pieces ---------------------------------------------------------------------

const DEMO_IBANS = [
  { value: 'NL91ABNA0417164300', hint: 'J. Jansen → accepted' },
  { value: 'NL00ABNA0417164300', hint: 'typo → rejected by the validator, never reaches the workflow' },
  { value: 'NL20INGB0001234567', hint: 'registered to P. de Vries → form reopens' },
  { value: 'NL44RABO0123456789', hint: 'closed account → form reopens' },
  { value: 'NL36INGB0007654321', hint: 'unknown to the bank → form reopens' },
];

/** In --yes mode the "agent" first submits someone else's IBAN, then the right one. */
const AUTO_AGENT_SEQUENCE = ['NL20INGB0001234567', 'NL91ABNA0417164300'];

async function submitFromTerminal(lead: Lead, signing: SigningState, autoIndex: number): Promise<void> {
  const { ctx } = lead;
  const form = signing.agentForm!;
  let iban = await choose(
    ctx,
    'IBAN to submit',
    [
      ...DEMO_IBANS.map((i) => ({ value: i.value, label: formatIban(i.value), hint: i.hint })),
      { value: 'other', label: 'Type another IBAN…' },
    ],
    AUTO_AGENT_SEQUENCE[Math.min(autoIndex, AUTO_AGENT_SEQUENCE.length - 1)],
  );
  if (iban === 'other') {
    const typed = await p.text({ message: 'IBAN', placeholder: 'NL91 ABNA 0417 1643 00' });
    if (p.isCancel(typed)) return;
    iban = typed;
  }
  let accountHolder = form.prefill.accountHolder;
  if (!ctx.auto) {
    const typed = await p.text({ message: 'Account holder', initialValue: accountHolder });
    if (p.isCancel(typed)) return;
    accountHolder = typed;
  }

  const spin = p.spinner();
  spin.start(`Submitting ${formatIban(iban)} (update → workflow verifies with the bank)`);
  try {
    const result = await lead.child.executeUpdate(submitPaymentDetailsUpdate, { args: [{ iban, accountHolder }] });
    if (result.accepted) {
      spin.stop(pc.green(`Accepted: mandate ${result.mandate.mandateReference}, the workflow continues`));
    } else {
      spin.stop(pc.yellow(`Rejected by the workflow: ${result.reason}`));
      p.log.warn(`The form is reopened (${result.rejectedSubmissions} rejected so far)`);
    }
  } catch (err) {
    if (!(err instanceof WorkflowUpdateFailedError)) throw err;
    spin.stop(pc.red(`Rejected by the validator: ${err.cause?.message ?? err.message}`));
    p.log.warn('Nothing reached the workflow history; the form is still open');
  }
}

function agentFormHook(): NonNullable<FollowHooks['onAgentForm']> {
  let submissions = 0;
  return async (lead, signing) => {
    const form = signing.agentForm!;
    p.note(
      [
        kv('Customer', form.customerName),
        kv('Reason', pc.yellow(form.reason)),
        kv('Rejected', String(form.rejectedSubmissions)),
        kv('Agent page', pc.underline(`${API_URL}/agent`)),
      ].join('\n'),
      pc.magenta('Agent form open'),
    );
    const how = await choose(
      lead.ctx,
      'How do you want to fill in the form?',
      [
        { value: 'terminal', label: 'Submit from this terminal', hint: 'pick a demo IBAN' },
        { value: 'browser', label: 'Open the agent page in the browser', hint: 'this CLI waits until you submit there' },
      ],
      'terminal',
    );

    if (how === 'terminal') {
      await submitFromTerminal(lead, signing, submissions++);
      return;
    }

    if (process.platform === 'darwin') spawn('open', [`${API_URL}/agent`], { stdio: 'ignore', detached: true }).unref();
    for (;;) {
      lead.waiter.wait(`Waiting for the agent at ${API_URL}/agent`);
      await sleep(500);
      const now = await lead.child.query(getSigningStateQuery);
      if (now.stage !== 'AWAITING_AGENT' && now.stage !== 'VERIFYING_PAYMENT_DETAILS') break;
      if (now.stage === 'AWAITING_AGENT' && now.agentForm && now.agentForm.rejectedSubmissions !== form.rejectedSubmissions) {
        lead.waiter.pause();
        p.log.warn(`Agent submission rejected: ${now.agentForm.reason}`);
        break;
      }
    }
    lead.waiter.pause();
  };
}

function operatorHook(fix?: { label: string; apply(): Promise<void> }): NonNullable<FollowHooks['onNeedsAttention']> {
  return async (lead, parked, where) => {
    const explanation =
      parked.step === 'contractSigning'
        ? 'The signing child FAILED (red in the Temporal UI). The lead is parked, the car is still reserved.'
        : 'The step ran out of retries. The workflow waits for an operator, without a timeout.';
    p.note(
      [kv('Step', pc.bold(parked.step)), kv('Last error', pc.red(truncate(parked.error, 60))), kv('Parked in', where), '', pc.dim(explanation)].join('\n'),
      pc.yellow('⚠ Needs attention'),
    );
    const options = [
      ...(fix ? [{ value: 'fix' as const, label: `${fix.label}, then retry`, hint: 'runs the step again with a fresh retry policy' }] : []),
      { value: 'retry' as const, label: 'Retry without fixing', hint: 'it fails again and you end up back here' },
      { value: 'abort' as const, label: 'Abort the lead', hint: 'compensation releases the car, lead FAILED' },
    ];
    const action = await choose(lead.ctx, 'What does the operator do?', options, fix ? 'fix' : 'retry');
    if (action === 'fix') {
      await fix!.apply();
      p.log.success(fix!.label);
    }
    const target = where === 'lead' ? lead.handle : lead.child;
    await target.executeUpdate(operatorActionUpdate, {
      args: [{ action: action === 'abort' ? 'abort' : 'retry', note: 'npm run demo' }],
    });
    p.log.info(`${pc.dim('operator →')} ${action === 'abort' ? pc.red('abort') : 'retry'} ${pc.dim('(update operatorAction)')}`);
  };
}

// --- Scenarios ---------------------------------------------------------------------------------------

export const scenarios: Scenario[] = [
  {
    id: 'happy',
    group: 'Happy path',
    title: 'Happy path',
    hint: 'valid IBAN, runs straight through',
    duration: '~10 s',
    expect: [
      'Credit bureau fails the first 2 calls (503) → Temporal retries after 1 s and 2 s',
      'Inventory and email fail randomly (30 % / 20 %) → retried, you may see a few',
      `IBAN ${formatIban('NL91ABNA0417164300')} is verified by the bank: no agent needed`,
      'The customer accepts the quote and signs → lease ACTIVE',
    ],
    run: async (ctx) => follow(ctx, await startLead(ctx, demoLead())),
  },
  {
    id: 'agent-form',
    group: 'Human in the loop',
    title: 'Missing IBAN → agent form',
    hint: 'an agent fills in the IBAN; wrong values go back to the form',
    duration: 'interactive',
    expect: [
      'The application has no IBAN → the signing child opens a form and waits (no timeout)',
      'Fill it in from this terminal, or in the browser at /agent',
      'Typo in the IBAN → rejected instantly by the update validator',
      'Someone else\'s or a closed account → the workflow rejects it and reopens the form',
      `${formatIban('NL91ABNA0417164300')} (J. Jansen) → accepted, contract goes out → ACTIVE`,
    ],
    run: async (ctx) =>
      follow(ctx, await startLead(ctx, demoLead({ iban: undefined })), { onAgentForm: agentFormHook() }),
  },
  {
    id: 'application-iban-rejected',
    group: 'Human in the loop',
    title: 'Application IBAN fails verification → agent form',
    hint: 'the customer typed someone else\'s IBAN',
    duration: 'interactive',
    expect: [
      `The application has ${formatIban('NL20INGB0001234567')}, registered to P. de Vries`,
      'The bank check says NO_MATCH → the agent form opens with that reason',
      'Same form as the previous scenario; submit the right IBAN to continue → ACTIVE',
    ],
    run: async (ctx) =>
      follow(ctx, await startLead(ctx, demoLead({ iban: 'NL20INGB0001234567' })), { onAgentForm: agentFormHook() }),
  },
  {
    id: 'decline',
    group: 'Human in the loop',
    title: 'Customer declines the quote',
    hint: 'saga compensation releases the car',
    duration: '~10 s',
    expect: [
      'Runs up to the quote, then the customer declines (signal)',
      'Compensation: the reserved vehicle is released at the inventory',
      'Ends QUOTE_DECLINED (a business outcome; the workflow completes normally)',
    ],
    run: async (ctx) => follow(ctx, await startLead(ctx, demoLead()), { quote: 'decline' }),
  },
  {
    id: 'esign-outage',
    group: 'Failure & recovery',
    title: 'E-sign outage → child fails → fix and retry',
    hint: '3 × 502 fails the signing child; the parent waits for you',
    duration: 'interactive',
    expect: [
      'The mock e-sign provider is switched DOWN: every call returns 502',
      'The e-sign call gets 3 attempts, then the signing child FAILS (red in the Temporal UI)',
      'The parent does not fail: NEEDS_ATTENTION, and the car stays reserved',
      'You bring e-sign back up and retry → a NEW child run under the same id → ACTIVE',
      'Credit check and reservation are not repeated; the verified IBAN is reused',
    ],
    async run(ctx) {
      await chaos({ esign: { failureRate: 1, failFirstN: 0 } });
      p.log.warn(`E-sign provider is ${pc.red('DOWN')} (every call returns 502)`);
      return follow(ctx, await startLead(ctx, demoLead()), {
        onNeedsAttention: operatorHook({
          label: 'Bring the e-sign provider back up',
          apply: () => chaos({ esign: { failureRate: 0 } }),
        }),
      });
    },
  },
  {
    id: 'credit-outage',
    group: 'Failure & recovery',
    title: 'Credit bureau outage → retries → operator',
    hint: 'watch the backoff; recover mid-way or after retries run out',
    duration: '~30 s – 2.5 min',
    expect: [
      'The mock credit bureau is switched DOWN (503 on every call)',
      'Temporal retries with exponential backoff: 1 s, 2 s, 4 s … capped at 30 s (10 attempts)',
      'Recover mid-way → the next attempt succeeds and the lead continues by itself',
      'Or let the retries run out (~2.5 min) → NEEDS_ATTENTION → fix + operator retry',
    ],
    async run(ctx) {
      const when = await choose(
        ctx,
        'When does the credit bureau come back?',
        [
          { value: 'halfway', label: 'Mid-way, at attempt 5', hint: '~15 s: Temporal recovers on its own' },
          { value: 'never', label: 'Not until an operator fixes it', hint: '~2.5 min of retries, then NEEDS_ATTENTION' },
        ],
        'halfway',
      );
      await chaos({ creditBureau: { failureRate: 1, failFirstN: 0 } });
      p.log.warn(`Credit bureau is ${pc.red('DOWN')} (every call returns 503)`);
      let recovered = false;
      return follow(ctx, await startLead(ctx, demoLead()), {
        async onTick({ pending, waiter }) {
          const credit = pending.find((a) => a.type === 'runCreditCheck');
          if (when === 'halfway' && !recovered && credit && credit.attempt >= 5) {
            recovered = true;
            await chaos({ creditBureau: { failureRate: 0 } });
            waiter.pause();
            p.log.success(`Credit bureau is back ${pc.green('UP')}; the next retry will succeed`);
          }
        },
        onNeedsAttention: operatorHook({
          label: 'Bring the credit bureau back up',
          apply: () => chaos({ creditBureau: { failureRate: 0 } }),
        }),
      });
    },
  },
  {
    id: 'timeout',
    group: 'Failure & recovery',
    title: 'Hanging inventory → activity timeout → retry',
    hint: 'a call that never answers is abandoned after 10 s',
    duration: '~25 s',
    expect: [
      'The mock inventory answers after 15 s; the activity has a 10 s startToCloseTimeout',
      'Attempt 1 is abandoned at 10 s (TIMEOUT) and retried',
      'The inventory recovers before attempt 2 → reservation succeeds → ACTIVE',
    ],
    async run(ctx) {
      await chaos({ inventory: { latencyMs: 15_000, failureRate: 0 } });
      p.log.warn(`Inventory is ${pc.yellow('SLOW')} (15 s per call, the timeout is 10 s)`);
      let firstSeen: number | undefined;
      let restored = false;
      return follow(ctx, await startLead(ctx, demoLead()), {
        async onTick({ pending, waiter }) {
          if (!pending.some((a) => a.type === 'reserveVehicle')) return;
          firstSeen ??= Date.now();
          if (!restored && Date.now() - firstSeen > 9_500) {
            restored = true;
            await chaos({ inventory: { latencyMs: 500 } });
            waiter.pause();
            p.log.success(`Inventory is fast again; attempt 1 is about to time out and be retried`);
          }
        },
      });
    },
  },
  {
    id: 'unknown-model',
    group: 'Failure & recovery',
    title: 'Unknown vehicle model → non-retryable failure',
    hint: 'HTTP 404: retrying will not help, fail fast',
    duration: '~5 s',
    expect: [
      'The lead asks for a "Fiat Multipla"; the inventory answers 404',
      '4xx is non-retryable: no retries, no operator parking',
      'The workflow fails immediately (red in the Temporal UI), lead FAILED',
    ],
    run: async (ctx) => follow(ctx, await startLead(ctx, demoLead({ vehicleModel: 'Fiat Multipla' }))),
  },
  {
    id: 'credit-rejected',
    group: 'Failure & recovery',
    title: 'Credit rejected (business outcome)',
    hint: 'a low score is a result, not an error',
    duration: '~5 s',
    expect: [
      'The email contains "reject" → the mock bureau returns a score below 620',
      'Not an error: the workflow completes normally with CREDIT_REJECTED',
    ],
    run: async (ctx) => follow(ctx, await startLead(ctx, demoLead({ email: 'jan+reject@example.com' }))),
  },
  {
    id: 'reset-child',
    group: 'Temporal power tools',
    title: 'Reset only the signing child',
    hint: 're-run the child; the parent follows the new run',
    duration: '~15 s',
    expect: [
      'Runs until the signing child waits for the signature',
      'Then resets the child to its first workflow task: a new run starts, the old one is terminated',
      'The parent keeps waiting and picks up the new run',
      'Only the child\'s steps run twice (see "re-run" in the retries summary) → ACTIVE',
    ],
    run: async (ctx) =>
      follow(ctx, await startLead(ctx, demoLead()), {
        async onAwaitingSignature(lead, runNumber) {
          if (runNumber > 1) return lead.sign();
          const action = await choose(
            lead.ctx,
            'The signing child waits for the signature. Reset it now?',
            [
              { value: 'reset', label: 'Reset the signing child', hint: `like ${cmd(`npm run reset -- ${lead.child.workflowId}`)}` },
              { value: 'sign', label: 'Skip the reset, just sign' },
            ],
            'reset',
          );
          if (action === 'sign') return lead.sign();
          const { runId } = await resetToFirstWorkflowTask(lead.ctx.client, lead.child.workflowId, 'npm run demo');
          p.log.info(`${pc.dim('operator →')} reset ${lead.child.workflowId} ${pc.dim(`→ new run …${runId.slice(-8)}`)}`);
        },
      }),
  },
  {
    id: 'worker-crash',
    group: 'Temporal power tools',
    title: 'Worker crash while waiting',
    hint: 'stop and restart the worker; nothing is lost',
    duration: 'interactive',
    expect: [
      'Runs until the quote is sent, then pauses',
      `You stop the worker (Ctrl+C in the ${cmd('npm run dev')} terminal) and start it again`,
      'The quote is accepted while the worker is down; the workflow continues once it is back → ACTIVE',
    ],
    run: async (ctx) =>
      follow(ctx, await startLead(ctx, demoLead()), {
        quote: 'manual',
        async onQuoteSent(lead) {
          p.note(
            `The workflow is now waiting for the quote decision.\nIts state lives in Temporal, not in the worker.`,
            'Worker crash',
          );
          await pressEnter(ctx, `Stop the worker now (Ctrl+C in the ${cmd('npm run dev')} terminal). Done?`);
          await lead.handle.signal(quoteDecisionSignal, { accepted: true });
          p.log.info(`${pc.dim('customer →')} accepts the quote while no worker is running ${pc.dim('(signal stored by Temporal)')}`);
          await pressEnter(ctx, `Start it again (${cmd('npm run dev')}). Done?`);
        },
      }),
  },
];

export async function runScenario(ctx: DemoContext, scenario: Scenario): Promise<FollowResult> {
  await chaosReset(); // every scenario starts from the default mock settings
  try {
    return await scenario.run(ctx);
  } finally {
    await chaosReset(); // and never leaves a service down
  }
}
