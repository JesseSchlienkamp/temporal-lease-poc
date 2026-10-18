import { callExternal, tracked } from '../common/activity-support';
import type { EmailTemplate } from './types';

/** Sends an email through the (flaky) notification service. */
export async function sendEmail(
  leadId: string,
  to: string,
  template: EmailTemplate,
  data: Record<string, unknown> = {},
): Promise<void> {
  return tracked(leadId, `sendEmail:${template}`, async () => {
    await callExternal('POST', '/notifications/email', { to, template, data }, `${leadId}:${template}`);
  });
}
