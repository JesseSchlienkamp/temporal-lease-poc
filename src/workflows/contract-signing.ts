import { condition, defineQuery, defineSignal, setHandler } from '@temporalio/workflow';
import type { Duration } from '@temporalio/common';
import type { Contract, ContractSigned, Quote } from '../shared/types';
import { external, local } from './activity-proxies';

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
}

export const contractSignedSignal = defineSignal<[ContractSigned]>('contractSigned');
export const getSigningStateQuery = defineQuery<SigningState>('getSigningState');

/**
 * Child workflow: contract -> e-signature envelope -> wait for the signature.
 *
 * Runs under its own workflow id (see signingWorkflowId), so it can be reset to its first
 * workflow task without touching the parent's history: the credit check and vehicle reservation
 * are not repeated. Every step here is idempotent, so re-running it from the start is safe.
 */
export async function contractSigning(input: ContractSigningInput): Promise<ContractSigningResult> {
  const { leadId, quote, signerEmail } = input;
  const state: SigningState = { stage: 'CREATING_CONTRACT' };
  let signature: ContractSigned | undefined;

  setHandler(getSigningStateQuery, () => state);
  setHandler(contractSignedSignal, (signed) => {
    signature ??= signed;
  });

  const draft = await local.createContract(leadId, quote);
  state.contract = draft;

  state.stage = 'SENDING_FOR_SIGNATURE';
  const contract = await external.requestSignature(leadId, draft.contractId, signerEmail);
  state.contract = contract;
  await external.sendEmail(leadId, signerEmail, 'contract-ready', { signingUrl: contract.signingUrl });

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
