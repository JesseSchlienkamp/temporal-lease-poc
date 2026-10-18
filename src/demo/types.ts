// Types of the demo CLI.
import type { Client, WorkflowHandle } from '@temporalio/client';
import type { ParkedStep } from '../workflows/common/types';
import type { SigningState } from '../workflows/carLeaseOnboarding/childWorkflows/contractSigning/types';
import type { OnboardingState } from '../workflows/carLeaseOnboarding/types';
import type { carLeaseOnboarding } from '../workflows/carLeaseOnboarding/carLeaseOnboarding.workflow';
import type { Waiter } from './runtime';

export interface DemoContext {
  client: Client;
  /** Non-interactive: every prompt takes its default answer. */
  auto: boolean;
}

export interface Scenario {
  id: string;
  group: string;
  title: string;
  hint: string;
  duration: string;
  expect: string[];
  run(ctx: DemoContext): Promise<FollowResult>;
}

export type MenuChoice = string | 'tool:chaos' | 'tool:chaos-reset' | 'tool:tests' | 'tool:recheck' | 'exit';

// --- Following a lead ------------------------------------------------------------------------------

/** A lead being followed, handed to the scenario's hooks. */
export interface Lead {
  ctx: DemoContext;
  leadId: string;
  handle: WorkflowHandle<typeof carLeaseOnboarding>;
  child: WorkflowHandle;
  waiter: Waiter;
  sign(): Promise<void>;
}

export interface FollowHooks {
  /** What the customer does with the quote. 'manual' = the scenario sends the signal itself. */
  quote?: 'accept' | 'decline' | 'manual';
  /** Called once when the quote is sent and quote = 'manual'. */
  onQuoteSent?(lead: Lead): Promise<void>;
  /** Called every time the signing child is waiting for an agent. Should return once something changed. */
  onAgentForm?(lead: Lead, signing: SigningState): Promise<void>;
  /** Called every time a step is parked for an operator. Should send an operator command. */
  onNeedsAttention?(lead: Lead, parked: ParkedStep, where: 'lead' | 'signing child'): Promise<void>;
  /** Called when a signing child run waits for the signature. Default: the customer signs. */
  onAwaitingSignature?(lead: Lead, runNumber: number): Promise<void>;
  /** Called on every poll, e.g. to change the mock services mid-flight. */
  onTick?(tick: Tick): Promise<void>;
}

export interface Tick {
  state: OnboardingState;
  signing?: SigningState;
  pending: PendingActivity[];
  waiter: Waiter;
}

export interface PendingActivity {
  type: string;
  attempt: number;
  lastFailure?: string;
}

export interface FollowResult {
  leadId: string;
  state?: OnboardingState;
  error?: string;
}

/** Per activity type, aggregated over all runs of a lead (for the summary). */
export interface StepStats {
  runs: number;
  retries: number;
  failed: boolean;
  completed: boolean;
  lastError?: string;
}
