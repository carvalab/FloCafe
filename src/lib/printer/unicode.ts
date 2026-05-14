/**
 * unicode.ts
 *
 * Fallback map for Unicode currency symbols on ESC/POS thermal printers.
 *
 * ESC/POS thermal printers render bytes against a fixed code page
 * (typically CP437 / CP850 / CP1252), none of which contain modern
 * currency symbols like ₹ (U+20B9, added to Unicode in 2010). When the
 * printer firmware cannot render a symbol, the 2–3 UTF-8 bytes that
 * encode it print as garbage glyphs.
 *
 * When the user marks their printer as *not* Unicode-capable, we replace
 * these symbols with an ASCII equivalent before handing bytes to the
 * printer.
 */

export const CURRENCY_ASCII_MAP: Record<string, string> = {
  '₹': 'Rs', // Indian Rupee
  '₨': 'Rs', // Rupee sign
  '€': 'EUR',
  '£': 'GBP',
  '¥': 'Yen',
  '₩': 'KRW',
  '₺': 'TRY',
  '₫': 'VND',
  '₪': 'NIS',
  '₽': 'RUB',
  '฿': 'THB',
  '₱': 'PHP',
  '₴': 'UAH',
  '₦': 'NGN',
  '₵': 'GHS',
  '₡': 'CRC',
  '₲': 'PYG',
};

export function normalizeCurrencyToAscii(text: string): string {
  let out = text;
  for (const [sym, ascii] of Object.entries(CURRENCY_ASCII_MAP)) {
    if (out.includes(sym)) out = out.split(sym).join(ascii);
  }
  return out;
}
