import * as p from '@clack/prompts';
import { Client, WorkflowFailedError, type WorkflowHandle } from '@temporalio/client';
import pc from 'picocolors';
import { randomUUID } from 'node:crypto';
import { config } from '../config';
import { signingWorkflowId } from '../shared/ids';
import { connectClient } from '../temporal-connection';
import { getStateQuery, quoteDecisionSignal } from '../workflows/carLeaseOnboarding/messages';
import type { LeadInput, OnboardingOptions, OnboardingState, OnboardingStatus } from '../workflows/carLeaseOnboarding/types';
import type { carLeaseOnboarding } from '../workflows/carLeaseOnboarding/carLeaseOnboarding.workflow';
import { contractSignedSignal, getSigningStateQuery } from '../workflows/carLeaseOnboarding/childWorkflows/contractSigning/messages';
import type { SigningState } from '../workflows/carLeaseOnboarding/childWorkflows/contractSigning/types';
import type { DemoContext, FollowHooks, FollowResult, Lead, PendingActivity, StepStats } from './types';

export const API_URL = `http://localhost:${config.apiPort}`;
export const UI_URL = 'http://localhost:8233';
export const workflowUrl = (workflowId: string) =>
  `${UI_URL}/namespaces/${config.temporal.namespace}/workflows/${encodeURIComponent(workflowId)}`;

export class Cancelled extends Error {}

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// --- Formatting ------------------------------------------------------------------------------------

const STATUS_COLOR: Partial<Record<OnboardingStatus, (s: string) => string>> = {
  ACTIVE: pc.green,
  FAILED: pc.red,
  DISQUALIFIED: pc.red,
  CREDIT_REJECTED: pc.red,
  QUOTE_DECLINED: pc.yellow,
  QUOTE_EXPIRED: pc.yellow,
  SIGNATURE_EXPIRED: pc.yellow,
  NEEDS_ATTENTION: (s) => pc.bold(pc.yellow(s)),
  AWAITING_AGENT: pc.magenta,
};
export const status = (s: OnboardingStatus) => (STATUS_COLOR[s] ?? pc.cyan)(s);

export const bullets = (lines: string[]) => lines.map((l) => `${pc.dim('•')} ${l}`).join('\n');
export const cmd = (s: string) => pc.cyan(s);
export const kv = (key: string, value: string, width = 12) => `${pc.dim(key.padEnd(width))} ${value}`;
export const truncate = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/** "POST /credit-bureau/score -> HTTP 503: {...}" -> "HTTP 503"; timeouts and others shortened. */
export function shortError(message: string): string {
  const http = message.match(/HTTP (\d{3})/);
  if (http) return `HTTP ${http[1]}`;
  if (/timeout/i.test(message)) return 'timed out';
  return truncate(message, 40);
}

/** One spinner at a time; pause it before logging so log lines don't interleave with frames. */
export class Waiter {
  private spin?: ReturnType<typeof p.spinner>;
  private msg = '';
  wait(msg: string) {
    if (!this.spin) {
      this.spin = p.spinner();
      this.spin.start(msg);
    } else if (msg !== this.msg) {
      this.spin.message(msg);
    }
    this.msg = msg;
  }
  pause() {
    this.spin?.clear();
    this.spin = undefined;
    this.msg = '';
  }
}

/** A select prompt that takes `auto` as the answer in non-interactive mode. */
export async function choose<T extends string>(
  ctx: DemoContext,
  message: string,
  options: { value: T; label: string; hint?: string }[],
  auto: T,
): Promise<T> {
  if (ctx.auto) {
    p.log.info(`${message} ${pc.dim('→ (auto)')} ${options.find((o) => o.value === auto)?.label}`);
    return auto;
  }
  const answer = await p.select<T>({ message, options: options as never, initialValue: auto });
  if (p.isCancel(answer)) throw new Cancelled();
  return answer;
}

export async function pressEnter(ctx: DemoContext, message: string): Promise<void> {
  if (ctx.auto) return;
  const ok = await p.confirm({ message, active: 'Done', inactive: 'Cancel', initialValue: true });
  if (p.isCancel(ok) || !ok) throw new Cancelled();
}

// --- Environment --------------------------------------------------------------------------------------

async function httpOk(url: string): Promise<boolean> {
  try {
    return (await fetch(url, { signal: AbortSignal.timeout(2000) })).ok;
  } catch {
    return false;
  }
}

/** Checks Temporal, the worker, the mock services and the API. Returns a client when Temporal is up. */
export async function preflight(): Promise<{ client?: Client; ok: boolean }> {
  const spin = p.spinner();
  spin.start('Checking the local stack');

  let client: Client | undefined;
  let temporal = false;
  let pollers = 0;
  try {
    client = new Client({
      connection: await connectClient({ connectTimeout: '3s' }),
      namespace: config.temporal.namespace,
    });
    await client.workflowService.describeNamespace({ namespace: config.temporal.namespace });
    temporal = true;
    const queue = await client.workflowService.describeTaskQueue({
      namespace: config.temporal.namespace,
      taskQueue: { name: config.taskQueue },
      taskQueueType: 1, // workflow task queue
    });
    pollers = queue.pollers?.length ?? 0;
  } catch {
    // reported below
  }
  const [mocks, api] = await Promise.all([httpOk(`${config.mockServicesUrl}/health`), httpOk(`${API_URL}/health`)]);
  spin.stop('Local stack');

  const line = (ok: boolean, name: string, detail: string, fix: string) =>
    `${ok ? pc.green('✔') : pc.red('✖')} ${name.padEnd(14)} ${ok ? pc.dim(detail) : pc.red(fix)}`;
  p.note(
    [
      line(temporal, 'Temporal', `${config.temporal.address} · UI ${UI_URL}`, `not reachable at ${config.temporal.address}: run ${cmd('npm run temporal')}`),
      line(pollers > 0, 'Worker', `polling "${config.taskQueue}"`, `no worker on "${config.taskQueue}": run ${cmd('npm run dev')}`),
      line(mocks, 'Mock services', config.mockServicesUrl, `not reachable: run ${cmd('npm run dev')}`),
      line(api, 'API', `${API_URL} · agent page /agent`, `not reachable: run ${cmd('npm run dev')}`),
    ].join('\n'),
    'Environment',
  );
  return { client: temporal ? client : undefined, ok: temporal && pollers > 0 && mocks && api };
}

// --- Mock services ------------------------------------------------------------------------------------

export async function chaos(settings: Record<string, Record<string, number>>): Promise<void> {
  const res = await fetch(`${config.mockServicesUrl}/admin/chaos`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(settings),
  });
  if (!res.ok) throw new Error(`Mock chaos update failed: HTTP ${res.status}`);
}

export async function chaosReset(): Promise<void> {
  await fetch(`${config.mockServicesUrl}/admin/chaos/reset`, { method: 'POST' }).catch(() => undefined);
}

export async function chaosSettings(): Promise<Record<string, Record<string, number>>> {
  return (await (await fetch(`${config.mockServicesUrl}/admin/chaos`)).json()) as Record<string, Record<string, number>>;
}

// --- Leads --------------------------------------------------------------------------------------------

export const demoLead = (overrides: Partial<LeadInput> = {}): LeadInput => ({
  firstName: 'Jan',
  lastName: 'Jansen',
  email: 'jan.jansen@example.com',
  dateOfBirth: '1988-05-17',
  annualIncome: 62_000,
  vehicleModel: 'Volvo EX30',
  iban: 'NL91ABNA0417164300',
  ...overrides,
});

export async function startLead(ctx: DemoContext, lead: LeadInput, options: OnboardingOptions = {}) {
  const leadId = `lead-${randomUUID().slice(0, 8)}`;
  const handle = await ctx.client.workflow.start<typeof carLeaseOnboarding>('carLeaseOnboarding', {
    taskQueue: config.taskQueue,
    workflowId: leadId,
    args: [lead, { quoteDecisionTimeout: '30 minutes', signatureTimeout: '30 minutes', ...options }],
  });
  p.log.step(
    `Started ${pc.bold(leadId)}  ${pc.dim(
      `${lead.firstName} ${lead.lastName} · ${lead.vehicleModel} · ${lead.iban ? `IBAN ${lead.iban}` : 'no IBAN'}`,
    )}\n${pc.dim(workflowUrl(leadId))}`,
  );
  return handle;
}

async function pendingActivities(handle: WorkflowHandle): Promise<PendingActivity[]> {
  try {
    const { raw } = await handle.describe();
    return (raw.pendingActivities ?? []).map((a) => ({
      type: a.activityType?.name ?? '?',
      attempt: a.attempt ?? 1,
      lastFailure: a.lastFailure?.message ?? undefined,
    }));
  } catch {
    return [];
  }
}

/**
 * Follows a lead until its workflow closes: prints every status change, plays the customer
 * (quote decision, signature) and hands the interactive moments to the scenario's hooks.
 */
export async function follow(
  ctx: DemoContext,
  handle: WorkflowHandle<typeof carLeaseOnboarding>,
  hooks: FollowHooks = {},
): Promise<FollowResult> {
  const leadId = handle.workflowId;
  const child = ctx.client.workflow.getHandle(signingWorkflowId(leadId));
  const waiter = new Waiter();
  const lead: Lead = {
    ctx,
    leadId,
    handle,
    child,
    waiter,
    async sign() {
      await child.signal(contractSignedSignal, { signedAt: new Date().toISOString(), signerName: 'Jan Jansen' });
      waiter.pause();
      p.log.info(`${pc.dim('customer →')} signs the contract ${pc.dim('(signal to the signing child)')}`);
    },
  };

  let last = '';
  let lastStatus: OnboardingStatus | undefined;
  let quoteHandled = false;
  let childRunId: string | undefined;
  let childRuns = 0;
  let signedRun: string | undefined;

  try {
    for (;;) {
      const description = await handle.describe();
      if (description.status.name !== 'RUNNING') break;

      const state = await handle.query(getStateQuery);
      let signing: SigningState | undefined;
      if (state.signingWorkflowId) {
        try {
          const childDescription = await child.describe();
          if (childDescription.runId !== childRunId) {
            childRunId = childDescription.runId;
            childRuns++;
          }
          signing = await child.query(getSigningStateQuery);
        } catch {
          // child not started yet
        }
      }

      const now = `${state.status}|${signing?.stage ?? ''}|${childRunId ?? ''}`;
      if (now !== last) {
        last = now;
        waiter.pause();
        const stage = signing ? pc.dim(`  signing${childRuns > 1 ? ` (run ${childRuns})` : ''}: `) + signing.stage : '';
        const note = state.status !== lastStatus ? state.history.at(-1)?.note : undefined;
        lastStatus = state.status;
        p.log.step(`${status(state.status)}${stage}${note ? pc.dim(`  ${truncate(note, 60)}`) : ''}`);
      }

      const pending = [...(await pendingActivities(handle)), ...(signing ? await pendingActivities(child) : [])];
      await hooks.onTick?.({ state, signing, pending, waiter });

      // --- the customer and the humans ---
      if (state.status === 'QUOTE_SENT' && !quoteHandled) {
        quoteHandled = true;
        waiter.pause();
        const decision = hooks.quote ?? 'accept';
        if (decision === 'manual') {
          await hooks.onQuoteSent?.(lead);
        } else {
          await handle.signal(quoteDecisionSignal, {
            accepted: decision === 'accept',
            reason: decision === 'decline' ? 'Too expensive' : undefined,
          });
          p.log.info(`${pc.dim('customer →')} ${decision === 'accept' ? 'accepts' : 'declines'} the quote ${pc.dim('(signal)')}`);
        }
      } else if (state.needsAttention || signing?.needsAttention) {
        const parked = (state.needsAttention ?? signing?.needsAttention)!;
        const where = state.needsAttention ? 'lead' : 'signing child';
        waiter.pause();
        if (!hooks.onNeedsAttention) {
          waiter.wait('Waiting for an operator (POST /leads/:id/operator)');
        } else {
          await hooks.onNeedsAttention(lead, parked, where);
          // Don't ask twice: wait until the workflow has picked up the command for this parked step.
          const source = where === 'lead' ? () => handle.query(getStateQuery) : () => child.query(getSigningStateQuery);
          for (let i = 0; i < 50 && (await source()).needsAttention?.since === parked.since; i++) await sleep(200);
        }
      } else if (signing?.stage === 'AWAITING_AGENT' && signing.agentForm) {
        waiter.pause();
        if (hooks.onAgentForm) await hooks.onAgentForm(lead, signing);
        else waiter.wait(`Waiting for an agent at ${API_URL}/agent`);
      } else if (signing?.stage === 'AWAITING_SIGNATURE' && signedRun !== childRunId) {
        signedRun = childRunId;
        waiter.pause();
        if (hooks.onAwaitingSignature) await hooks.onAwaitingSignature(lead, childRuns);
        else await lead.sign();
      } else {
        const retrying = pending.find((a) => a.attempt > 1);
        waiter.wait(
          retrying
            ? `${retrying.type} · attempt ${retrying.attempt}${retrying.lastFailure ? pc.dim(` · last: ${shortError(retrying.lastFailure)}`) : ''}`
            : pending[0]
              ? `${pending[0].type}…`
              : 'Working…',
        );
      }
      await sleep(400);
    }

    waiter.pause();
    const state = await handle.result();
    return { leadId, state };
  } catch (err) {
    waiter.pause();
    if (err instanceof Cancelled) throw err;
    if (err instanceof WorkflowFailedError) {
      let cause: Error = err;
      while (cause.cause instanceof Error) cause = cause.cause;
      const state = await handle.query(getStateQuery).catch(() => undefined);
      return { leadId, state, error: cause.message };
    }
    throw err;
  }
}

// --- Summary ------------------------------------------------------------------------------------------

/** Prints the outcome: final status, timeline, retries per step (from the audit table) and links. */
export async function summarize(ctx: DemoContext, result: FollowResult): Promise<void> {
  const { leadId, state, error } = result;
  const finalStatus = state?.status ?? 'FAILED';

  const timeline = (state?.history ?? []).map((h) => {
    const time = new Date(h.at).toLocaleTimeString();
    return `${pc.dim(time.padEnd(11))} ${status(h.status)}${' '.repeat(Math.max(1, 19 - h.status.length))}${pc.dim(truncate(h.note ?? '', 38))}`;
  });

  const executions = [];
  for await (const execution of ctx.client.workflow.list({ query: `WorkflowId STARTS_WITH '${leadId}'` })) {
    executions.push(execution);
  }
  // Parent first, then each child run in start order.
  executions.sort(
    (a, b) => a.workflowId.length - b.workflowId.length || a.startTime.getTime() - b.startTime.getTime(),
  );
  const retries = await retriesFromHistory(ctx, executions);
  const runs = executions.map((e) => {
    const color = e.status.name === 'COMPLETED' ? pc.green : e.status.name === 'RUNNING' ? pc.cyan : pc.red;
    return `${color(e.status.name.padEnd(11))} ${e.workflowId} ${pc.dim(`run …${e.runId.slice(-8)}`)}`;
  });

  const headline =
    finalStatus === 'ACTIVE'
      ? pc.green(pc.bold('✔ Lease ACTIVE'))
      : error
        ? `${pc.red(pc.bold(`✖ Workflow failed · ${shortError(error)}`))}\n${pc.dim(truncate(error, 70))}`
        : status(finalStatus);

  p.note(
    [
      headline,
      '',
      pc.bold('Timeline'),
      ...timeline,
      '',
      pc.bold('Retries and re-runs (from the Temporal history)'),
      ...(retries.length ? retries : [pc.dim('none: every step succeeded on the first attempt')]),
      '',
      pc.bold('Workflow runs'),
      ...runs,
      '',
      kv('Temporal UI', workflowUrl(leadId)),
      kv('Database', cmd(`npm run db:show -- ${leadId}`)),
    ].join('\n'),
    `Result · ${leadId}`,
  );
}

/** Activities that legitimately run more than once per lead; don't report them as re-runs. */
const REPEATING = new Set(['sendEmail', 'updateLeadStatus', 'openAgentTask', 'verifyBankAccount']);

/**
 * Per activity type: how often it was scheduled, how many retries it needed (attempt - 1 on each
 * ActivityTaskStarted) and whether it finally failed. Child activities are prefixed "signing:".
 */
async function retriesFromHistory(
  ctx: DemoContext,
  executions: { workflowId: string; runId: string }[],
): Promise<string[]> {
  const stats = new Map<string, StepStats>();
  for (const { workflowId, runId } of executions) {
    const prefix = workflowId.endsWith('-signing') ? 'signing: ' : '';
    const types = new Map<string, string>(); // scheduled event id -> activity type
    const { events = [] } = await ctx.client.workflow.getHandle(workflowId, runId).fetchHistory();
    for (const e of events ?? []) {
      const id = String(e.eventId);
      if (e.activityTaskScheduledEventAttributes) {
        const type = prefix + (e.activityTaskScheduledEventAttributes.activityType?.name ?? '?');
        types.set(id, type);
        const step = stats.get(type) ?? { runs: 0, retries: 0, failed: false, completed: false };
        step.runs++;
        stats.set(type, step);
      }
      const started = e.activityTaskStartedEventAttributes;
      if (started) {
        const step = stats.get(types.get(String(started.scheduledEventId)) ?? '');
        if (step && (started.attempt ?? 1) > 1) {
          step.retries += (started.attempt ?? 1) - 1;
          step.lastError = started.lastFailure?.message ?? step.lastError;
        }
      }
      const completed = e.activityTaskCompletedEventAttributes;
      if (completed) {
        const step = stats.get(types.get(String(completed.scheduledEventId)) ?? '');
        if (step) step.completed = true;
      }
      const failure = e.activityTaskFailedEventAttributes ?? e.activityTaskTimedOutEventAttributes;
      if (failure) {
        const step = stats.get(types.get(String(failure.scheduledEventId)) ?? '');
        if (step) {
          step.failed = true;
          step.lastError = failure.failure?.cause?.message ?? failure.failure?.message ?? step.lastError;
        }
      }
    }
  }

  const lines: string[] = [];
  for (const [type, step] of stats) {
    const reran = step.runs > 1 && !REPEATING.has(type.replace('signing: ', ''));
    if (!step.retries && !step.failed && !reran) continue;
    const parts = [
      step.retries ? pc.yellow(`${step.retries} ${step.retries === 1 ? 'retry' : 'retries'}`) : '',
      step.failed ? pc.red(step.completed ? 'failed in one run' : 'failed') : '',
      reran ? pc.cyan(`ran ${step.runs}×`) : '',
      step.lastError ? pc.dim(shortError(step.lastError)) : '',
    ].filter(Boolean);
    const icon = !step.completed ? pc.red('✖') : reran && !step.retries ? pc.cyan('↻') : pc.green('✔');
    lines.push(`${icon} ${type.padEnd(28)} ${parts.join(pc.dim(' · '))}`);
  }
  return lines;
}
