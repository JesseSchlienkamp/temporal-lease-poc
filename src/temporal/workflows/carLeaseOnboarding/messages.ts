// Signals and queries of the carLeaseOnboarding workflow. Import these from clients (API, CLI)
// without pulling in workflow code.
import { defineQuery, defineSignal } from '@temporalio/workflow';
import type { OnboardingState, QuoteDecision } from './types';

export const quoteDecisionSignal = defineSignal<[QuoteDecision]>('quoteDecision');

export const getStateQuery = defineQuery<OnboardingState>('getState');
