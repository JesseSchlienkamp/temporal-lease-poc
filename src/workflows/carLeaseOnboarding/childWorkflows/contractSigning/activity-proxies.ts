import { proxyActivities } from '@temporalio/workflow';
import { ESIGN_ACTIVITY, EXTERNAL_ACTIVITY, LOCAL_ACTIVITY } from '../../../common/activity-options';
import type * as parentActivities from '../../activities';
import type * as activities from './activities';

/** This child's own activities, plus the two it shares with the parent workflow. */
type Activities = typeof activities & Pick<typeof parentActivities, 'updateLeadStatus' | 'sendEmail'>;

export const local = proxyActivities<Activities>(LOCAL_ACTIVITY);
export const external = proxyActivities<Activities>(EXTERNAL_ACTIVITY);
export const esign = proxyActivities<Activities>(ESIGN_ACTIVITY);
