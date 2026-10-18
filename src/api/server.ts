import { Client, WorkflowNotFoundError } from '@temporalio/client';
import express, { type ErrorRequestHandler } from 'express';
import { randomUUID } from 'node:crypto';
import { config } from '../config';
import { signingWorkflowId } from '../shared/ids';
import type { LeadInput, OnboardingOptions } from '../shared/types';
import { connectClient } from '../temporal-connection';
import {
  carLeaseOnboarding,
  contractSignedSignal,
  getSigningStateQuery,
  getStateQuery,
  quoteDecisionSignal,
} from '../workflows';

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
    await client.workflow.start(carLeaseOnboarding, {
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

  const onError: ErrorRequestHandler = (err, _req, res, _next) => {
    if (err instanceof WorkflowNotFoundError) {
      res.status(404).json({ error: 'Lead not found' });
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
