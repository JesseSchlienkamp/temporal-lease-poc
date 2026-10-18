import { getDb } from '../db/database';
import type { LeadInput, OnboardingStatus, QualificationResult } from '../shared/types';
import { tracked } from './support';

const MIN_AGE = 18;
const MIN_ANNUAL_INCOME = 25_000;

export async function saveLead(leadId: string, lead: LeadInput): Promise<void> {
  return tracked(leadId, 'saveLead', () => {
    getDb()
      .prepare(
        `INSERT INTO leads (id, first_name, last_name, email, phone, date_of_birth, annual_income, vehicle_model, status)
         VALUES (@id, @firstName, @lastName, @email, @phone, @dateOfBirth, @annualIncome, @vehicleModel, 'LEAD_RECEIVED')
         ON CONFLICT(id) DO NOTHING`,
      )
      .run({
        id: leadId,
        firstName: lead.firstName,
        lastName: lead.lastName,
        email: lead.email,
        phone: lead.phone ?? null,
        dateOfBirth: lead.dateOfBirth,
        annualIncome: lead.annualIncome,
        vehicleModel: lead.vehicleModel,
      });
  });
}

export async function updateLeadStatus(leadId: string, status: OnboardingStatus, note?: string): Promise<void> {
  getDb()
    .prepare(`UPDATE leads SET status = ?, status_note = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(status, note ?? null, leadId);
}

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
