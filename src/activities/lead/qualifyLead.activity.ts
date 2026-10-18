import type { LeadInput, QualificationResult } from './types';
import { tracked } from '../common/activity-support';

const MIN_AGE = 18;
const MIN_ANNUAL_INCOME = 25_000;

/** Pure business rules, no external calls. */
export async function qualifyLead(leadId: string, lead: LeadInput): Promise<QualificationResult> {
  return tracked(leadId, 'qualifyLead', () => {
    const age = yearsSince(new Date(lead.dateOfBirth));
    if (!Number.isFinite(age)) return { qualified: false, reason: `Invalid date of birth: ${lead.dateOfBirth}` };
    if (age < MIN_AGE) return { qualified: false, reason: `Applicant must be at least ${MIN_AGE}` };
    if (lead.annualIncome < MIN_ANNUAL_INCOME) {
      return { qualified: false, reason: `Annual income below ${MIN_ANNUAL_INCOME}` };
    }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(lead.email)) return { qualified: false, reason: 'Invalid email address' };
    return { qualified: true };
  });
}

function yearsSince(date: Date): number {
  const now = new Date();
  let years = now.getFullYear() - date.getFullYear();
  const beforeBirthday =
    now.getMonth() < date.getMonth() || (now.getMonth() === date.getMonth() && now.getDate() < date.getDate());
  if (beforeBirthday) years--;
  return years;
}
