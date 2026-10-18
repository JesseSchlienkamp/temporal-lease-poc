import { condition, defineQuery, defineSignal, setHandler } from '@temporalio/workflow';
import type { Duration } from '@temporalio/common';
import type { Contract, ContractSigned, Quote } from '../shared/types';
import { external, local } from './activity-proxies';
import { createOperatorRecovery, type ParkedStep } from './operator-recovery';

export interface ContractSigningInput {
  leadId: string;
  quote: Quote;
  signerEmail: string;
  signatureTimeout?: Duration;
}

export type ContractSigningResult =
  | { outcome: 'SIGNED'; contract: Contract; signedAt: string; signerName?: string }
  | { outcome: 'EXPIRED'; contract: Contract };

export type SigningStage = 'CREATING_CONTRACT' | 'SENDING_FOR_SIGNATURE' | 'AWAITING_SIGNATURE' | 'SIGNED' | 'EXPIRED';

export interface SigningState {
  stage: SigningStage;
  contract?: Contract;
  /** Set while a step has exhausted its retries and waits for an operator. */
  needsAttention?: ParkedStep;
}

export const contractSignedSignal = defineSignal<[ContractSigned]>('contractSigned');
export const getSigningStateQuery = defineQuery<SigningState>('getSigningState');

/**
 * Child workflow: contract -> e-signature envelope -> wait for the signature.
 *
 * Runs under its own workflow id (see signingWorkflowId), so it can be reset to its first
 * workflow task without touching the parent's history: the credit check and vehicle reservation
 * are not repeated. Every step here is idempotent, so re-running it from the start is safe.
 *
 * Has its own operator recovery: send the `operatorAction` update to this child's workflow id.
 */
export async function contractSigning(input: ContractSigningInput): Promise<ContractSigningResult> {
  const { leadId, quote, signerEmail } = input;
  const state: SigningState = { stage: 'CREATING_CONTRACT' };
  let signature: ContractSigned | undefined;

  setHandler(getSigningStateQuery, () => state);
  setHandler(contractSignedSignal, (signed) => {
    signature ??= signed;
  });

  // The parent stays AWAITING_SIGNATURE; the lead row in the database shows the parked step.
  const recovery = createOperatorRecovery({
    async onPark(parked) {
      state.needsAttention = parked;
      await local.updateLeadStatus(leadId, 'NEEDS_ATTENTION', `${parked.step}: ${parked.error}`);
    },
    async onResume(parked, command) {
      state.needsAttention = undefined;
      await local.updateLeadStatus(leadId, 'AWAITING_SIGNATURE', `Operator ${command.action} at ${parked.step}`);
    },
  });

  const draft = await local.createContract(leadId, quote);
  state.contract = draft;

  state.stage = 'SENDING_FOR_SIGNATURE';
  const contract = await recovery.guard('requestSignature', () =>
    external.requestSignature(leadId, draft.contractId, signerEmail),
  );
  state.contract = contract;
  await recovery.guard('sendEmail:contract-ready', () =>
    external.sendEmail(leadId, signerEmail, 'contract-ready', { signingUrl: contract.signingUrl }),
  );

  state.stage = 'AWAITING_SIGNATURE';
  const signed = await condition(() => signature !== undefined, input.signatureTimeout ?? '14 days');
  if (!signed) {
    await local.expireContract(leadId, contract.contractId);
    state.stage = 'EXPIRED';
    return { outcome: 'EXPIRED', contract };
  }

  state.stage = 'SIGNED';
  return { outcome: 'SIGNED', contract, signedAt: signature!.signedAt, signerName: signature!.signerName };
}
