import { Client, WorkflowNotFoundError, WorkflowUpdateFailedError } from '@temporalio/client';
import express, { type ErrorRequestHandler } from 'express';
import { randomUUID } from 'node:crypto';
import { config } from '../config';
import { signingWorkflowId } from '../temporal/workflows/ids';
import { connectClient } from '../temporal/connection';
import { operatorActionUpdate } from '../temporal/workflows/common/messages';
import type { OperatorCommand } from '../temporal/workflows/common/types';
import { getStateQuery, quoteDecisionSignal } from '../temporal/workflows/carLeaseOnboarding/messages';
import type { OnboardingOptions } from '../temporal/workflows/carLeaseOnboarding/types';
import type { LeadInput } from '../temporal/activities/lead/types';
import type { carLeaseOnboarding } from '../temporal/workflows/carLeaseOnboarding/carLeaseOnboarding.workflow';
import { contractSignedSignal, getSigningStateQuery, submitPaymentDetailsUpdate } from '../temporal/workflows/contractSigning/messages';
import type { AgentForm } from '../temporal/workflows/contractSigning/types';
import { agentPage } from './agent-page';

async function main() {
  const client = new Client({ connection: await connectClient(), namespace: config.temporal.namespace });
  const app = express();
  app.use(express.json());

  app.get('/health', (_req, res) => {
    res.json({ ok: true });
  });

  /** Start onboarding. Body: LeadInput, optionally with `options: { quoteDecisionTimeout, signatureTimeout }`. */
  app.post('/leads', async (req, res) => {
    const { options, ...lead } = req.body as LeadInput & { options?: OnboardingOptions };
    const leadId = `lead-${randomUUID().slice(0, 8)}`;
    await client.workflow.start<typeof carLeaseOnboarding>('carLeaseOnboarding', {
      taskQueue: config.taskQueue,
      workflowId: leadId,
      args: [lead, options ?? {}],
    });
    res.status(202).json({ leadId, links: { status: `/leads/${leadId}` } });
  });

  /** Live state straight from the running workflows (via queries), including the signing child once started. */
  app.get('/leads/:id', async (req, res) => {
    const handle = client.workflow.getHandle(req.params.id);
    const [description, state] = await Promise.all([handle.describe(), handle.query(getStateQuery)]);

    let signing;
    if (state.signingWorkflowId) {
      const child = client.workflow.getHandle(state.signingWorkflowId);
      const [childDescription, childState] = await Promise.all([child.describe(), child.query(getSigningStateQuery)]);
      signing = { workflowId: child.workflowId, workflowStatus: childDescription.status.name, ...childState };
    }

    res.json({ workflowStatus: description.status.name, ...state, signing });
  });

  /** Body: { accepted: boolean, reason?: string } */
  app.post('/leads/:id/quote-decision', async (req, res) => {
    const { accepted, reason } = req.body as { accepted?: boolean; reason?: string };
    if (typeof accepted !== 'boolean') {
      res.status(400).json({ error: '"accepted" (boolean) is required' });
      return;
    }
    await client.workflow.getHandle(req.params.id).signal(quoteDecisionSignal, { accepted, reason });
    res.status(202).json({ ok: true });
  });

  /**
   * Simulates the e-signature provider's "envelope completed" webhook. Body: { signerName?: string }
   * The signal goes to the lead's contract-signing child workflow.
   */
  app.post('/leads/:id/sign', async (req, res) => {
    const { signerName } = (req.body ?? {}) as { signerName?: string };
    await client.workflow
      .getHandle(signingWorkflowId(req.params.id))
      .signal(contractSignedSignal, { signedAt: new Date().toISOString(), signerName });
    res.status(202).json({ ok: true });
  });

  /**
   * Operator decision for a step that exhausted its retries (status NEEDS_ATTENTION).
   * Body: { action: "retry" | "abort", note?: string }. Goes to whichever workflow is parked: the
   * lead's onboarding workflow or its signing child.
   */
  app.post('/leads/:id/operator', async (req, res) => {
    const command = req.body as OperatorCommand;
    const parent = client.workflow.getHandle(req.params.id);
    const state = await parent.query(getStateQuery);

    let target = state.needsAttention ? parent : undefined;
    if (!target && state.signingWorkflowId) {
      const child = client.workflow.getHandle(state.signingWorkflowId);
      if ((await child.query(getSigningStateQuery)).needsAttention) target = child;
    }
    if (!target) {
      res.status(409).json({ error: 'Nothing is waiting for an operator' });
      return;
    }

    const parked = await target.executeUpdate(operatorActionUpdate, { args: [command] });
    res.json({ workflowId: target.workflowId, action: command.action, parked });
  });

  // --- Agent inbox --------------------------------------------------------------------------------

  app.get('/agent', (_req, res) => {
    res.type('html').send(agentPage);
  });

  /**
   * Open agent forms. Read from the running signing workflows (list + query), so the API does not
   * need the worker's database. At scale you'd use a custom search attribute instead of querying
   * every running workflow.
   */
  app.get('/agent/tasks', async (_req, res) => {
    const tasks: (AgentForm & { workflowId: string })[] = [];
    const running = client.workflow.list({ query: "WorkflowType = 'contractSigning' AND ExecutionStatus = 'Running'" });
    for await (const execution of running) {
      const state = await client.workflow.getHandle(execution.workflowId).query(getSigningStateQuery);
      if (state.agentForm && state.stage === 'AWAITING_AGENT') tasks.push({ workflowId: execution.workflowId, ...state.agentForm });
    }
    tasks.sort((a, b) => a.openedAt.localeCompare(b.openedAt));
    res.json(tasks);
  });

  /**
   * Submit the agent form. Body: { iban, accountHolder }.
   *   200 { accepted: true, mandate }                   verified, the workflow continues
   *   200 { accepted: false, reason, ... }              failed verification, the form is reopened
   *   422 { accepted: false, reason }                   rejected by the validator (malformed input)
   */
  app.post('/agent/tasks/:workflowId/payment-details', async (req, res) => {
    const { iban, accountHolder } = (req.body ?? {}) as { iban?: string; accountHolder?: string };
    try {
      const result = await client.workflow
        .getHandle(req.params.workflowId)
        .executeUpdate(submitPaymentDetailsUpdate, { args: [{ iban: iban ?? '', accountHolder: accountHolder ?? '' }] });
      res.json(result);
    } catch (err) {
      if (!(err instanceof WorkflowUpdateFailedError)) throw err;
      res.status(422).json({ accepted: false, reason: err.cause?.message ?? err.message });
    }
  });

  const onError: ErrorRequestHandler = (err, _req, res, _next) => {
    if (err instanceof WorkflowNotFoundError) {
      res.status(404).json({ error: 'Lead not found' });
      return;
    }
    if (err instanceof WorkflowUpdateFailedError) {
      // Rejected by the update validator, e.g. the step was resumed in the meantime or bad action
      res.status(409).json({ error: err.cause?.message ?? err.message });
      return;
    }
    console.error(err);
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  };
  app.use(onError);

  app.listen(config.apiPort, () => console.log(`API listening on http://localhost:${config.apiPort}`));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
