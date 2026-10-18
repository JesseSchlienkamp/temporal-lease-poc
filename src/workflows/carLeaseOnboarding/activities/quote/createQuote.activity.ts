import { getDb } from '../../../../db/database';
import type { CreditCheckResult, LeadInput, Quote, VehicleReservation } from '../../types';
import { tracked } from '../../../common/activity-support';

export async function createQuote(
  leadId: string,
  lead: LeadInput,
  reservation: VehicleReservation,
  credit: CreditCheckResult,
): Promise<Quote> {
  return tracked(leadId, 'createQuote', () => {
    const termMonths = lead.termMonths ?? 36;
    const annualKm = lead.annualKm ?? 15_000;
    const downPayment = lead.downPayment ?? 0;

    const quote: Quote = {
      quoteId: `${leadId}-quote`,
      monthlyPayment: monthlyLeasePayment(reservation.listPrice, termMonths, annualKm, downPayment, credit.score),
      termMonths,
      annualKm,
      downPayment,
    };

    getDb()
      .prepare(
        `INSERT INTO quotes (id, lead_id, monthly_payment, term_months, annual_km, down_payment, status)
         VALUES (?, ?, ?, ?, ?, ?, 'SENT')
         ON CONFLICT(id) DO NOTHING`,
      )
      .run(quote.quoteId, leadId, quote.monthlyPayment, termMonths, annualKm, downPayment);

    return quote;
  });
}

/** Simplified operational-lease formula: depreciation + finance charge. */
function monthlyLeasePayment(
  listPrice: number,
  termMonths: number,
  annualKm: number,
  downPayment: number,
  creditScore: number,
): number {
  const residualPct = clamp(0.62 - (termMonths - 24) * 0.005 - ((annualKm - 10_000) / 5_000) * 0.02, 0.3, 0.7);
  const residual = listPrice * residualPct;
  const annualRatePct = creditScore >= 750 ? 3.9 : creditScore >= 680 ? 5.9 : 7.9;
  const moneyFactor = annualRatePct / 2400;
  const depreciation = (listPrice - downPayment - residual) / termMonths;
  const financeCharge = (listPrice - downPayment + residual) * moneyFactor;
  return Math.round((depreciation + financeCharge) * 100) / 100;
}

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));
