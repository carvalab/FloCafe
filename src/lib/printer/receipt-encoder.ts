/**
 * receipt-encoder.ts
 *
 * Converts a Flo POS Bill (+ its nested Order) into raw ESC/POS bytes
 * using `@point-of-sale/receipt-printer-encoder`.
 *
 * Three templates are available:
 *   buildClassicReceiptBytes  — rich legacy-style (default)
 *   buildCompactReceiptBytes  — minimal, fast
 *   buildDetailedReceiptBytes — full GST compliance
 *
 * `buildReceiptBytes` is kept as a re-export of the classic builder
 * for backward compatibility.
 */

import ReceiptPrinterEncoder from '@point-of-sale/receipt-printer-encoder';
import type { Bill, Tenant } from '@/lib/types';
import { normalizeCurrencyToAscii } from './unicode';

export interface ReceiptOptions {
  /** 58 mm (32 chars) or 80 mm (48 chars). Default: 58 */
  paperWidth?: 58 | 80;
  /** Show a "Thank you" footer line. Default: true */
  showFooter?: boolean;
  /** Extra line of custom text printed below the footer. */
  footerNote?: string;
  /** GSTIN to print in footer / header */
  gstin?: string;
  /** Business address to print */
  address?: string;
  /** Business phone to print */
  phone?: string;
  /** Show per-tax-rate breakdown lines */
  showTaxBreakdown?: boolean;
  /** If false (default), replace ₹/€/£/etc. with ASCII (Rs, EUR, GBP…). */
  useUnicode?: boolean;
}

const CHARS: Record<58 | 80, number> = { 58: 32, 80: 48 };

// ---------------------------------------------------------------------------
// 4-column layout helpers
// ---------------------------------------------------------------------------

/**
 * Column widths for 4-column item tables.
 * Layout: [name, qty, rate, amount]
 */
function col4Widths(cols: number): [number, number, number, number] {
  if (cols >= 48) return [20, 4, 11, 13];
  // 32 cols: 14 + 3 + 7 + 8 = 32
  return [14, 3, 7, 8];
}

function col4Header(cols: number): string {
  const [w0, w1, w2, w3] = col4Widths(cols);
  const item = ' Item'.padEnd(w0);
  const qty = 'Qty'.padStart(w1);
  const rate = 'Rate'.padStart(w2);
  const amt = 'Amt'.padStart(w3);
  return item + qty + rate + amt;
}

function col4Row(
  name: string,
  qty: number,
  rate: number | string,
  amount: number | string,
  currency: string,
  cols: number
): string {
  const [w0, w1, w2, w3] = col4Widths(cols);
  const nameStr = truncate(name, w0).padEnd(w0);
  const qtyStr = String(qty).padStart(w1);
  const rateStr = formatAmount(rate, currency).padStart(w2);
  const amtStr = formatAmount(amount, currency).padStart(w3);
  return nameStr + qtyStr + rateStr + amtStr;
}

// ---------------------------------------------------------------------------
// Classic template
// ---------------------------------------------------------------------------

export function buildClassicReceiptBytes(
  bill: Bill,
  tenant: Pick<Tenant, 'business_name' | 'currency'>,
  opts: ReceiptOptions = {}
): Uint8Array {
  const {
    paperWidth = 58,
    showFooter = true,
    footerNote,
    gstin,
    address,
    phone,
    showTaxBreakdown = false,
    useUnicode = false,
  } = opts;
  const cols = CHARS[paperWidth];
  const rawCurrency = tenant.currency ?? '';
  const currency = useUnicode ? rawCurrency : normalizeCurrencyToAscii(rawCurrency);
  const order = bill.order;

  const enc = new ReceiptPrinterEncoder({ columns: cols });

  // Header
  enc
    .initialize()
    .align('center')
    .bold(true)
    .width(2)
    .height(2)
    .text(truncate(tenant.business_name, 16))
    .width(1)
    .height(1)
    .bold(false)
    .newline();

  if (order?.table?.name) {
    enc.bold(true).text(`Table: ${order.table.name}`).bold(false).newline();
  }
  if (order?.customer?.name) {
    enc.text(order.customer.name).newline();
    if (order.customer.phone) {
      enc.text(order.customer.phone).newline();
    }
  }

  enc
    .size('small')
    .text(padRow(`Bill #${bill.bill_number}`, formatDate(bill.order?.created_at), cols))
    .newline()
    .size('normal')
    .align('left')
    .rule({ style: 'single' });

  // 4-column header
  enc.text(col4Header(cols)).newline();
  enc.rule({ style: 'single' });

  // Line items
  const items = order?.items ?? [];
  for (const item of items) {
    enc
      .text(col4Row(item.product_name, item.quantity, item.unit_price, item.total, currency, cols))
      .newline();

    // Addons
    if (item.addons && item.addons.length > 0) {
      for (const addon of item.addons) {
        const addonLabel = truncate(`  + ${addon.name}`, cols - 8);
        if (addon.price && Number(addon.price) > 0) {
          const addonTotal = Number(addon.price) * item.quantity;
          enc.text(padRow(addonLabel, formatAmount(addonTotal, currency), cols)).newline();
        } else {
          enc.text(addonLabel).newline();
        }
      }
    }

    // Special instructions
    if (item.special_instructions) {
      enc.text(truncate(`  >> ${item.special_instructions}`, cols)).newline();
    }
  }

  enc.rule({ style: 'single' });

  // Totals
  enc.text(padRow('Subtotal', formatAmount(bill.subtotal, currency), cols)).newline();
  if (Number(bill.discount_amount) > 0) {
    enc.text(padRow('Discount', `-${formatAmount(bill.discount_amount, currency)}`, cols)).newline();
  }
  if (Number(bill.tax_amount) > 0) {
    enc.text(padRow('Tax', formatAmount(bill.tax_amount, currency), cols)).newline();
  }
  if (Number(bill.service_charge) > 0) {
    enc.text(padRow('Service Charge', formatAmount(bill.service_charge, currency), cols)).newline();
  }
  if (Number(bill.delivery_charge) > 0) {
    enc.text(padRow('Delivery', formatAmount(bill.delivery_charge, currency), cols)).newline();
  }

  enc.rule({ style: 'double' });
  enc
    .bold(true)
    .text(padRow('TOTAL', formatAmount(bill.total, currency), cols))
    .bold(false)
    .newline();
  enc.rule({ style: 'single' });

  // Payment methods
  if (bill.payment_details && bill.payment_details.length > 0) {
    for (const p of bill.payment_details) {
      enc.text(padRow(capitalise(p.method), formatAmount(p.amount, currency), cols)).newline();
    }
  }

  enc.newline();

  // Tax breakdown (optional)
  if (showTaxBreakdown && bill.tax_breakdown && bill.tax_breakdown.length > 0) {
    for (const t of bill.tax_breakdown) {
      enc
        .text(padRow(` ${t.title}@${t.rate}%`, formatAmount(t.amount, currency), cols))
        .newline();
    }
  }

  // Footer
  if (showFooter) {
    if (gstin) {
      enc
        .text(padRow(`GSTIN: ${gstin}`, `Bill #${bill.bill_number}`, cols))
        .newline();
    }
    if (address) {
      enc.align('center').text(truncate(address, cols)).newline().align('left');
    }
    if (phone) {
      enc.align('center').text(`Call: ${phone}`).newline().align('left');
    }
    enc.newline();
    enc.align('center').text('Thank you! Please visit again').newline();
    if (footerNote) {
      enc.text(truncate(footerNote, cols)).newline();
    }
    enc.align('left');
  }

  enc.newline().newline().newline().cut();

  return enc.encode();
}

// ---------------------------------------------------------------------------
// Compact template
// ---------------------------------------------------------------------------

export function buildCompactReceiptBytes(
  bill: Bill,
  tenant: Pick<Tenant, 'business_name' | 'currency'>,
  opts: ReceiptOptions = {}
): Uint8Array {
  const { paperWidth = 58, footerNote, useUnicode = false } = opts;
  const cols = CHARS[paperWidth];
  const rawCurrency = tenant.currency ?? '';
  const currency = useUnicode ? rawCurrency : normalizeCurrencyToAscii(rawCurrency);
  const order = bill.order;

  const enc = new ReceiptPrinterEncoder({ columns: cols });

  // Header
  enc
    .initialize()
    .align('center')
    .bold(true)
    .text(truncate(tenant.business_name, cols))
    .bold(false)
    .newline()
    .align('left')
    .rule({ style: 'single' });

  // Bill # and date on one line
  enc
    .text(padRow(`Bill #${bill.bill_number}`, formatDate(bill.order?.created_at), cols))
    .newline();

  if (order?.table?.name) {
    enc.text(`Table: ${order.table.name}`).newline();
  }
  if (order?.customer?.name) {
    enc.text(`Cust: ${truncate(order.customer.name, cols - 6)}`).newline();
  }

  enc.rule({ style: 'single' });

  // Items — compact: one line per item with total, qty x rate below if qty > 1
  const items = order?.items ?? [];
  for (const item of items) {
    const nameMax = cols - formatAmount(item.total, currency).length - 1;
    enc
      .text(padRow(truncate(item.product_name, nameMax), formatAmount(item.total, currency), cols))
      .newline();

    if (item.quantity > 1) {
      enc
        .size('small')
        .align('right')
        .text(`${item.quantity} x ${formatAmount(item.unit_price, currency)}`)
        .newline()
        .size('normal')
        .align('left');
    }
  }

  enc.rule({ style: 'single' });

  if (Number(bill.discount_amount) > 0) {
    enc.text(padRow('Discount', `-${formatAmount(bill.discount_amount, currency)}`, cols)).newline();
  }
  if (Number(bill.tax_amount) > 0) {
    enc.text(padRow('Tax', formatAmount(bill.tax_amount, currency), cols)).newline();
  }

  enc.rule({ style: 'double' });
  enc
    .bold(true)
    .text(padRow('TOTAL', formatAmount(bill.total, currency), cols))
    .bold(false)
    .newline();

  if (bill.payment_details && bill.payment_details.length > 0) {
    for (const p of bill.payment_details) {
      enc.text(padRow(capitalise(p.method), formatAmount(p.amount, currency), cols)).newline();
    }
  }

  enc.newline().align('center').text('Thank you!').newline();
  if (footerNote) {
    enc.text(truncate(footerNote, cols)).newline();
  }
  enc.align('left');

  enc.newline().newline().newline().cut();

  return enc.encode();
}

// ---------------------------------------------------------------------------
// Detailed (GST) template
// ---------------------------------------------------------------------------

export function buildDetailedReceiptBytes(
  bill: Bill,
  tenant: Pick<Tenant, 'business_name' | 'currency'>,
  opts: ReceiptOptions = {}
): Uint8Array {
  const { paperWidth = 58, footerNote, gstin, address, phone, useUnicode = false } = opts;
  const cols = CHARS[paperWidth];
  const rawCurrency = tenant.currency ?? '';
  const currency = useUnicode ? rawCurrency : normalizeCurrencyToAscii(rawCurrency);
  const order = bill.order;

  const enc = new ReceiptPrinterEncoder({ columns: cols });

  // Header
  enc
    .initialize()
    .align('center')
    .bold(true)
    .width(2)
    .height(2)
    .text(truncate(tenant.business_name, 16))
    .width(1)
    .height(1)
    .bold(false)
    .newline();

  if (gstin) {
    enc.bold(true).text(`GSTIN: ${gstin}`).bold(false).newline();
  }

  enc.bold(true).text('TAX INVOICE').bold(false).newline();

  if (address) {
    enc.text(truncate(address, cols)).newline();
  }
  if (phone) {
    enc.text(phone).newline();
  }

  enc.align('left').rule({ style: 'single' });

  // Bill info
  enc
    .text(padRow(`Bill #: ${bill.bill_number}`, formatDate(bill.order?.created_at), cols))
    .newline();

  if (order?.customer?.name) {
    enc
      .text(
        padRow(
          `Customer: ${truncate(order.customer.name, cols - 20)}`,
          order.customer.phone ?? '',
          cols
        )
      )
      .newline();
  }
  if (order?.table?.name) {
    enc.text(`Table: ${order.table.name}`).newline();
  }

  enc.rule({ style: 'single' });

  // 4-column items header
  enc.text(col4Header(cols)).newline();

  // Line items
  const items = order?.items ?? [];
  for (const item of items) {
    enc
      .text(col4Row(item.product_name, item.quantity, item.unit_price, item.total, currency, cols))
      .newline();

    if (item.addons && item.addons.length > 0) {
      for (const addon of item.addons) {
        const addonLabel = truncate(`  + ${addon.name}`, cols - 8);
        if (addon.price && Number(addon.price) > 0) {
          const addonTotal = Number(addon.price) * item.quantity;
          enc.text(padRow(addonLabel, formatAmount(addonTotal, currency), cols)).newline();
        } else {
          enc.text(addonLabel).newline();
        }
      }
    }

    if (item.special_instructions) {
      enc.text(truncate(`  >> ${item.special_instructions}`, cols)).newline();
    }
  }

  enc.rule({ style: 'single' });

  // Subtotal (excl. tax)
  enc
    .text(padRow('Subtotal (excl. tax)', formatAmount(bill.subtotal, currency), cols))
    .newline();

  enc.rule({ style: 'single' });

  // Tax breakdown — always shown in detailed mode
  if (bill.tax_breakdown && bill.tax_breakdown.length > 0) {
    for (const t of bill.tax_breakdown) {
      enc
        .text(padRow(` ${t.title} @${t.rate}%`, formatAmount(t.amount, currency), cols))
        .newline();
    }
  } else if (Number(bill.tax_amount) > 0) {
    enc.text(padRow('Tax', formatAmount(bill.tax_amount, currency), cols)).newline();
  }

  enc.rule({ style: 'double' });
  enc
    .bold(true)
    .text(padRow('TOTAL', formatAmount(bill.total, currency), cols))
    .bold(false)
    .newline();
  enc.rule({ style: 'single' });

  // Payment methods
  if (bill.payment_details && bill.payment_details.length > 0) {
    for (const p of bill.payment_details) {
      enc.text(padRow(capitalise(p.method), formatAmount(p.amount, currency), cols)).newline();
    }
  }

  enc.newline();
  enc
    .size('small')
    .align('center')
    .text('Rates inclusive of all applicable taxes')
    .newline()
    .size('normal')
    .align('left');

  if (footerNote) {
    enc.text(truncate(footerNote, cols)).newline();
  }
  enc.align('left');

  enc.newline().newline().newline().cut();

  return enc.encode();
}

// ---------------------------------------------------------------------------
// Backward-compat alias
// ---------------------------------------------------------------------------

/** @deprecated Use buildClassicReceiptBytes directly */
export const buildReceiptBytes = buildClassicReceiptBytes;

// ---------------------------------------------------------------------------
// Formatting helpers (shared)
// ---------------------------------------------------------------------------

function padRow(left: string, right: string, cols: number): string {
  const gap = cols - left.length - right.length;
  return gap > 0
    ? left + ' '.repeat(gap) + right
    : left.slice(0, cols - right.length - 1) + ' ' + right;
}

function truncate(str: string, max: number): string {
  return str.length > max ? str.slice(0, max - 1) + '\u2026' : str;
}

function formatAmount(value: number | string, currency: string): string {
  return `${currency}${Number(value).toLocaleString('en', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function capitalise(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function formatDate(iso?: string): string {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString('en', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}
