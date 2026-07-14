/**
 * Resolve the tax-id label printed on receipts. Explicit label wins, else
 * map by ISO country code, else default to "Tax ID". Shared between the
 * browser receipt builders and the backend thermal printer so both paths
 * emit the same string for a given country.
 */
export function resolveTaxIdLabel(country?: string, taxIdLabel?: string): string {
  if (taxIdLabel) return taxIdLabel;
  switch ((country ?? '').toUpperCase()) {
    case 'IN':
    case 'INDIA':
      return 'GSTIN';
    case 'AR':
    case 'ARGENTINA':
      return 'CUIT';
    default:
      return 'Tax ID';
  }
}
