// Signals, queries and updates of the contractSigning child workflow. Import these from clients
// (API, CLI) without pulling in workflow code.
import { defineQuery, defineSignal, defineUpdate } from '@temporalio/workflow';
import type { ContractSigned, SigningState, SubmitPaymentDetailsResult } from './types';
import type { PaymentDetails } from '../../activities/payment/types';

export const contractSignedSignal = defineSignal<[ContractSigned]>('contractSigned');

export const getSigningStateQuery = defineQuery<SigningState>('getSigningState');

/**
 * The agent form's submit. Malformed input is rejected by the validator (nothing is recorded in
 * history, the form stays open). Well-formed input is verified by the workflow; the update returns
 * that verdict, and on rejection the form is reopened with the reason.
 */
export const submitPaymentDetailsUpdate = defineUpdate<SubmitPaymentDetailsResult, [PaymentDetails]>(
  'submitPaymentDetails',
);
