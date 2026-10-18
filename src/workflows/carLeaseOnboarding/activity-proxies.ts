import { proxyActivities } from '@temporalio/workflow';
import { EXTERNAL_ACTIVITY, LOCAL_ACTIVITY } from '../common/activity-options';
import type * as activities from './activities';

export const local = proxyActivities<typeof activities>(LOCAL_ACTIVITY);
export const external = proxyActivities<typeof activities>(EXTERNAL_ACTIVITY);
