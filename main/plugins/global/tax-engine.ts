/**
 * Default tax engine — the in-process runtime backing `global.default`.
 *
 * Behavior mirrors the original core `calculateDefaultTax` branch for
 * countries without a dedicated package:
 *
 *  - Rate from `line.tax.rate` (caller passes `product.tax_rate`), with a
 *    label from `countries.ts`'s `taxName` for that
 *    country, falling back to "Tax" when no label is configured.
 *  - Inclusive math extracts tax from the unit price; exclusive math
 *    multiplies. Zero / negative rates return zero tax, matching the
 *    legacy `rate <= 0` short-circuit.
 *
 * `category` (e.g. `restaurant`) is forwarded unchanged; only the IN
 * tax engine reads it for fixed-rate overrides. We do not need that here.
 */

import { COUNTRIES } from '../../countries';
import type { TaxEngine } from '../api-types';

export const defaultTaxEngine: TaxEngine<'tax.default'> = {
  capabilityId: 'tax.default',
  calculate(request) {
    const country = (request.country || '').toUpperCase();

    const lines = request.lines.map((line) => {
      const base = line.unitPrice.amountMinor * line.quantity;
      const rate = line.tax.rate || 0;
      if (rate <= 0) {
        return {
          code: line.tax.category || 'tax',
          label: labelFor(country),
          rate,
          amount: { amountMinor: 0, currency: request.currency },
          included: line.tax.included,
        };
      }
      const amount = line.tax.included
        ? Math.round(base - base / (1 + rate / 100))
        : Math.round(base * rate / 100);
      return {
        code: line.tax.category || 'tax',
        label: labelFor(country),
        rate,
        amount: { amountMinor: amount, currency: request.currency },
        included: line.tax.included,
      };
    });

    const subtotalMinor = request.lines.reduce(
      (total, line) => total + line.unitPrice.amountMinor * line.quantity,
      0,
    );
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

function labelFor(country: string): string {
  return COUNTRIES.find((c) => c.code === country)?.taxName || 'Tax';
}
