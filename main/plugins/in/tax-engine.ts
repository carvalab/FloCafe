import type { TaxEngine } from '../api-types';

const FIXED_RATES: Record<string, number> = { restaurant: 5, salon: 5 };

export const inTaxEngine: TaxEngine<'tax.gst'> = {
  capabilityId: 'tax.gst',
  calculate(request) {
    const rateFor = (line: typeof request.lines[number]) => FIXED_RATES[line.tax.category || ''] ?? line.tax.rate;
    const subtotalMinor = request.lines.reduce(
      (total, line) => total + line.unitPrice.amountMinor * line.quantity,
      0,
    );
    const interState = Boolean(request.customer?.fiscalIdentity && request.customer.regionCode && request.storeRegionCode && request.customer.regionCode !== request.storeRegionCode);
    const lines = request.lines.flatMap((line) => {
      const rate = rateFor(line);
      const base = line.unitPrice.amountMinor * line.quantity;
      const amount = line.tax.included
        ? Math.round(base - base / (1 + rate / 100))
        : Math.round(base * rate / 100);
      if (interState) return [{ code: 'igst', label: 'IGST', rate, amount: { amountMinor: amount, currency: request.currency }, included: line.tax.included }];
      const firstHalf = Math.round(amount / 2);
      return [
        { code: 'cgst', label: 'CGST', rate: rate / 2, amount: { amountMinor: firstHalf, currency: request.currency }, included: line.tax.included },
        { code: 'sgst', label: 'SGST', rate: rate / 2, amount: { amountMinor: amount - firstHalf, currency: request.currency }, included: line.tax.included },
      ];
    });
    const totalTaxMinor = lines.reduce((total, line) => total + line.amount.amountMinor, 0);
    const exclusiveTaxMinor = lines.filter((line) => !line.included).reduce((total, line) => total + line.amount.amountMinor, 0);
    return {
      subtotal: { amountMinor: subtotalMinor, currency: request.currency },
      lines,
      totalTax: { amountMinor: totalTaxMinor, currency: request.currency },
      total: { amountMinor: subtotalMinor + exclusiveTaxMinor, currency: request.currency },
    };
  },
};
