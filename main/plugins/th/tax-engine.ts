import type { TaxEngine } from '../api-types';

const VAT_RATE = 7;

export const thTaxEngine: TaxEngine<'tax.vat'> = {
  capabilityId: 'tax.vat',
  calculate(request) {
    const lines = request.lines.map((line) => {
      const base = line.unitPrice.amountMinor * line.quantity;
      const amount = line.tax.included
        ? Math.round(base - base / (1 + VAT_RATE / 100))
        : Math.round(base * VAT_RATE / 100);
      return {
        code: line.tax.category || 'vat',
        label: 'VAT',
        rate: VAT_RATE,
        amount: { amountMinor: amount, currency: request.currency },
        included: line.tax.included,
      };
    });
    const subtotalMinor = request.lines.reduce((total, line) => total + line.unitPrice.amountMinor * line.quantity, 0);
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
