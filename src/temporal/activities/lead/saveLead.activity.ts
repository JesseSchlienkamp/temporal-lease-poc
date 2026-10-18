import { getDb } from '../../../db/database';
import type { LeadInput } from './types';
import { tracked } from '../common/activity-support';

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
