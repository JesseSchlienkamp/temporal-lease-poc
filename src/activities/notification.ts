import { callExternal, tracked } from './support';

export type EmailTemplate = 'quote' | 'credit-rejected' | 'contract-ready' | 'welcome';

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
