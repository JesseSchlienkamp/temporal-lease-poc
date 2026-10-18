// Quote domain.

export interface Quote {
  quoteId: string;
  monthlyPayment: number;
  termMonths: number;
  annualKm: number;
  downPayment: number;
}

export type QuoteStatus = 'SENT' | 'ACCEPTED' | 'DECLINED' | 'EXPIRED';
