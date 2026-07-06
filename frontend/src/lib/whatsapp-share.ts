/**
 * whatsapp-share.ts
 *
 * Generate WhatsApp share links for bills.
 * Uses wa.me API to pre-fill message with bill details.
 */

import type { Bill, Tenant, Customer } from '@/lib/types';

export interface WhatsAppShareOptions {
  /** Points earned from this bill (cashback) */
  pointsEarned?: number;
  /** Current wallet balance */
  walletBalance?: number;
  /** Business phone for WhatsApp business account */
  businessPhone?: string;
}

/**
 * Generate a wa.me URL for sharing bill details via WhatsApp.
 */
export function getWhatsAppShareUrl(
  bill: Bill,
  tenant: Pick<Tenant, 'business_name' | 'currency'>,
  customer: Pick<Customer, 'phone' | 'country_code'> | null,
  opts: WhatsAppShareOptions = {}
): string {
  const { pointsEarned = 0, walletBalance, businessPhone } = opts;
  const currency = tenant.currency ?? '₹';

  // Build the message
  const lines: string[] = [];

  lines.push(`*${tenant.business_name}*`);
  lines.push(`Bill #: ${bill.bill_number}`);
  lines.push(`Date: ${formatDate(bill.order?.created_at)}`);
  lines.push(``);
  lines.push(`*Total: ${formatAmount(bill.total, currency)}*`);

  if (pointsEarned > 0) {
    lines.push(``);
    lines.push(`You earned ${pointsEarned} loyalty points! 🎉`);
  }

  if (walletBalance !== undefined && walletBalance > 0) {
    lines.push(`Your wallet balance: ${formatAmount(walletBalance, currency)}`);
  }

  lines.push(``);
  lines.push(`Thank you for your visit!`);

  const message = lines.join('\n');

  // Determine phone number to send to
  const phone = customer?.phone?.replace(/\D/g, '') || '';
  const countryCode = customer?.country_code?.replace(/\D/g, '') || '91';

  // Use wa.me API - works for both personal and business WhatsApp
  // If businessPhone is provided, send to business account, otherwise to customer
  const waPhone = businessPhone?.replace(/\D/g, '') || '';

  // Build wa.me URL
  const waUrl = `https://wa.me/${waPhone || phone}?text=${encodeURIComponent(message)}`;

  return waUrl;
}

/**
 * Open WhatsApp share in a new window/tab.
 */
export function shareBillViaWhatsApp(
  bill: Bill,
  customerInfo: Pick<Customer, 'phone' | 'country_code'> | null,
  tenant: Pick<Tenant, 'business_name' | 'currency'>,
  opts: WhatsAppShareOptions = {}
): void {
  const url = getWhatsAppShareUrl(bill, tenant, customerInfo, opts);
  window.open(url, '_blank');
}

/**
 * Generate just the message text (for copying to clipboard).
 */
export function getWhatsAppMessage(
  bill: Bill,
  tenant: Pick<Tenant, 'business_name' | 'currency'>,
  opts: WhatsAppShareOptions = {}
): string {
  const { pointsEarned = 0, walletBalance } = opts;
  const currency = tenant.currency ?? '₹';

  const lines: string[] = [];

  lines.push(`${tenant.business_name}`);
  lines.push(`Bill #: ${bill.bill_number}`);
  lines.push(`Date: ${formatDate(bill.order?.created_at)}`);
  lines.push(``);
  lines.push(`Total: ${formatAmount(bill.total, currency)}`);

  if (pointsEarned > 0) {
    lines.push(``);
    lines.push(`You earned ${pointsEarned} loyalty points!`);
  }

  if (walletBalance !== undefined && walletBalance > 0) {
    lines.push(`Your wallet balance: ${formatAmount(walletBalance, currency)}`);
  }

  lines.push(``);
  lines.push(`Thank you for your visit!`);

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatAmount(value: number | string, currency: string): string {
  return `${currency}${Number(value).toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDate(iso?: string): string {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString('en', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return iso;
  }
}
