import type { TaxEngine } from '../api-types';

export const arTaxEngine: TaxEngine<'tax.iva'> = {
  capabilityId: 'tax.iva',
  calculate(request) {
    const subtotalMinor = request.lines.reduce(
      (total, line) => total + line.unitPrice.amountMinor * line.quantity,
      0,
    );
    const lines = request.lines.map((line) => {
      const base = line.unitPrice.amountMinor * line.quantity;
      const amount = line.tax.included
        ? Math.round(base - base / (1 + line.tax.rate / 100))
        : Math.round(base * line.tax.rate / 100);
      return {
        code: line.tax.category || 'iva',
        label: 'IVA',
        rate: line.tax.rate,
        amount: { amountMinor: amount, currency: request.currency },
        included: line.tax.included,
      };
    });
    const totalTaxMinor = lines.reduce((total, line) => total + line.amount.amountMinor, 0);
    const exclusiveTaxMinor = lines
      .filter((line) => !line.included)
      .reduce((total, line) => total + line.amount.amountMinor, 0);
    return {
      subtotal: { amountMinor: subtotalMinor, currency: request.currency },
      lines,
      totalTax: { amountMinor: totalTaxMinor, currency: request.currency },
      total: { amountMinor: subtotalMinor + exclusiveTaxMinor, currency: request.currency },
    };
  },
};
