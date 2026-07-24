/**
 * Tax engine — the core dispatcher.
 *
 * Stage 1 (this file) keeps every public export from the original
 * implementation (`calculateItemTax`, `aggregateTaxBreakdown`,
 * `calculateRoundOff`, `calculateTaxPreview`) with byte-for-byte
 * identical inputs/outputs so existing endpoints and tests don't
 * change.
 *
 * The country switch is gone. Country-specific math now lives in
 * `main/plugins/{ar,in}/tax-engine.ts`, and the generic default math
 * (Thailand 7% VAT plus the original `product.tax_rate` / inclusive /
 * exclusive / taxName behavior) lives in
 * `main/plugins/global/tax-engine.ts`. This file only retains the early
 * `tax_type === 'none'` guard — the dispatcher hands every other
 * request to the resolved tax plugin and converts its envelope back to
 * the legacy shape.
 *
 * `getTaxEngineForCountry()` is activation-aware. When the country
 * package is installed but not activated, or no package is installed at
 * all, the dispatcher returns undefined and the function returns the
 * same shape as the legacy `calculateDefaultTax` fallback
 * (`tax_amount: 0`, empty breakdown) so the order pipeline keeps
 * working without a tax pack. Existing tests rely on that no-op
 * behavior for "unactivated store" scenarios.
 *
 * ponytail: this is the seam, not a refactor opportunity. Adding a new
 * country in Stage 2 means dropping another country package into
 * `main/plugins/<code>/` and registering it in `runtime-registry.ts`.
 * Don't preempt that.
 */

import { COUNTRIES } from '../countries';
import { getTaxEngineForCountry } from '../plugins/runtime-registry';
import type { FiscalIdentity } from '../plugins/api-types';

interface TenantInfo {
  country: string;
  business_type: string;
  state_code: string;
}

interface Product {
  tax_type: string;
  tax_rate: number;
}

interface Customer {
  gstin?: string;
  customer_state_code?: string;
  cuit?: string;
  fiscalIdentity?: FiscalIdentity;
}

interface TaxResult {
  tax_amount: number;
  tax_breakdown: TaxBreakdown[];
  tax_type: string;
}

interface TaxBreakdown {
  title: string;
  rate: number;
  amount: number;
}

function round(value: number, decimals: number = 2): number {
  return Math.round(value * Math.pow(10, decimals)) / Math.pow(10, decimals);
}

/**
 * Returns the per-item tax for a single product line. Every consumer
 * (orders, bills, preview endpoint) calls this. Country-specific math
 * and the default / Thailand branches now live in the plugin runtimes.
 */
export function calculateItemTax(
  tenant: TenantInfo,
  product: Product,
  taxableAmount: number,
  customer: Customer | null
): TaxResult {
  if (product.tax_type === 'none') {
    return { tax_amount: 0, tax_breakdown: [], tax_type: 'none' };
  }

  const taxEngine = getTaxEngineForCountry(tenant.country);
  if (!taxEngine) {
    // No activated tax plugin covers this store. Keep the order pipeline
    // moving with a zero-tax line so existing behavior for "unactivated
    // store" scenarios is preserved byte-for-byte.
    return { tax_amount: 0, tax_breakdown: [], tax_type: product.tax_type };
  }

  const currency = COUNTRIES.find((country) => country.code === tenant.country)?.currency || 'USD';
  const result = taxEngine.calculate({
    installationId: 'core',
    storeId: 'local',
    country: tenant.country,
    requestId: `tax-${Date.now()}`,
    currency,
    storeRegionCode: tenant.state_code,
    lines: [{
      description: 'order item',
      quantity: 1,
      unitPrice: { amountMinor: Math.round(taxableAmount * 100), currency },
      tax: { rate: product.tax_rate || 0, included: product.tax_type === 'inclusive', category: tenant.business_type },
    }],
    // Generic fiscal identity. The country engine decides whether
    // GSTIN, CUIT, or anything else changes the math. GST computation
    // is here; fiscal invoice authorization is a separate `fiscal.*`
    // capability and lives elsewhere.
    customer: customer ? { fiscalIdentity: resolveFiscalIdentity(customer), regionCode: customer.customer_state_code } : undefined,
  });
  return {
    tax_amount: result.totalTax.amountMinor / 100,
    tax_breakdown: result.lines.map((line) => ({ title: line.label, rate: line.rate, amount: line.amount.amountMinor / 100 })),
    tax_type: product.tax_type,
  };
}

/**
 * Resolves a customer record into a generic fiscal identity. The
 * customer table still stores country-specific fields (gstin, cuit).
 * New countries should add a field; this resolver normalizes the
 * legacy fields into the `{type, value}` shape the contracts use.
 */
function resolveFiscalIdentity(customer: Customer): FiscalIdentity | undefined {
  if (customer.fiscalIdentity) return customer.fiscalIdentity;
  if (customer.cuit) return { type: 'cuit', value: customer.cuit };
  if (customer.gstin) return { type: 'gstin', value: customer.gstin };
  return undefined;
}

export function aggregateTaxBreakdown(itemBreakdowns: any[]): TaxBreakdown[] {
  const merged: Record<string, TaxBreakdown> = {};

  for (const breakdown of itemBreakdowns) {
    if (!Array.isArray(breakdown)) continue;
    for (const line of breakdown) {
      const key = `${line.title}_${line.rate}`;
      if (!merged[key]) {
        merged[key] = { title: line.title, rate: line.rate, amount: 0 };
      }
      merged[key].amount += line.amount;
    }
  }

  return Object.values(merged).map((line) => ({
    ...line,
    amount: round(line.amount, 2),
  }));
}

export function calculateRoundOff(total: number): number {
  const rounded = Math.round(total);
  return round(rounded - total, 2);
}

// Tax preview endpoint handler
export async function calculateTaxPreview(req: any, res: any): Promise<void> {
  try {
    const { items, customer_id, packaging_charge } = req.body;

    if (!items || items.length === 0) {
      res.status(400).json({ error: 'Items are required' });
      return;
    }

    const db = (await import('../db')).getDatabase();

    // Get settings
    const settings: Record<string, string> = {};
    db.prepare('SELECT key, value FROM settings').all().forEach((row: any) => {
      settings[row.key] = row.value;
    });

    const tenantInfo: TenantInfo = {
      country: settings.country || 'IN',
      business_type: settings.business_type || 'restaurant',
      state_code: settings.state_code || '',
    };

    const customer = customer_id
      ? (db.prepare('SELECT * FROM customers WHERE id = ?').get(customer_id) as Customer | undefined)
      : null;

    const itemResults: any[] = [];
    const allBreakdowns: any[] = [];
    let totalSubtotal = 0;
    let totalTax = 0;

    for (const itemData of items) {
      const product = db.prepare('SELECT * FROM products WHERE id = ?').get(itemData.product_id) as any;
      if (!product) continue;

      const unitPrice = parseFloat(product.price) || 0;
      const quantity = itemData.quantity || 1;
      const itemDiscount = itemData.discount_amount || 0;

      let subtotal = unitPrice * quantity;
      if (itemData.addons) {
        for (const addon of itemData.addons) {
          subtotal += (addon.price || 0) * (addon.quantity || 1) * quantity;
        }
      }
      subtotal = Math.max(0, subtotal - itemDiscount);

      const taxResult = calculateItemTax(tenantInfo, product as Product, subtotal, customer || null);

      itemResults.push({
        product_id: product.id,
        product_name: product.name,
        quantity,
        unit_price: unitPrice,
        subtotal: round(subtotal, 2),
        discount_amount: itemDiscount,
        tax_amount: taxResult.tax_amount,
        tax_breakdown: taxResult.tax_breakdown,
        tax_type: taxResult.tax_type,
        total: round(subtotal + taxResult.tax_amount, 2),
      });

      if (taxResult.tax_breakdown) {
        allBreakdowns.push(taxResult.tax_breakdown);
      }
      totalSubtotal += subtotal;
      totalTax += taxResult.tax_amount;
    }

    const aggregatedBreakdown = aggregateTaxBreakdown(allBreakdowns);
    const packaging = packaging_charge || 0;
    const preRoundTotal = totalSubtotal + totalTax + packaging;
    const roundOff = calculateRoundOff(preRoundTotal);

    res.json({
      items: itemResults,
      summary: {
        subtotal: round(totalSubtotal, 2),
        tax_amount: round(totalTax, 2),
        tax_breakdown: aggregatedBreakdown,
        packaging_charge: packaging,
        round_off: roundOff,
        total: round(preRoundTotal + roundOff, 2),
      },
    });
  } catch (error: any) {
    console.error('[Tax] Preview error:', error);
    res.status(500).json({ error: "Internal server error" });
  }
}
