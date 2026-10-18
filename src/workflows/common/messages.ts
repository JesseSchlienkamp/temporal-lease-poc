// Messages shared by all workflows that use operator recovery.
import { defineUpdate } from '@temporalio/workflow';
import type { OperatorCommand, ParkedStep } from './types';

/**
 * Operator decision for a parked step. An update rather than a signal, so the command is rejected
 * (and the caller gets an error) when nothing is waiting for an operator.
 */
export const operatorActionUpdate = defineUpdate<ParkedStep, [OperatorCommand]>('operatorAction');
