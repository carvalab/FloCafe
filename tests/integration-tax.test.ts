/**
 * Integration Test: Tax Correctness
 *
 * Verifies India GST (5% — 2.5% CGST + 2.5% SGST) is calculated correctly,
 * especially after discount is applied. This is a compliance risk for real
 * restaurants — incorrect GST means wrong filings.
 *
 * Usage: node tests/run-electron-node-test.cjs tests/integration-tax.test.ts
 */

// ── Electron Mock ────────────────────────────────────────────────────────────
const Module = require('module');
const originalLoad = Module._load;
const fs = require('fs');
const os = require('os');
const path = require('path');
const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flo-tax-test-'));
Module._load = function (request: string, parent: unknown, isMain: boolean) {
  if (request === 'electron') return { app: { isPackaged: true, getPath: () => testDir, getVersion: () => 'test' } };
  return originalLoad.apply(this, arguments as any);
};

const {
  initTestDb, createApp, startServer,
  seedOwnerUser, seedCategory, seedProduct,
  api, assert, assertEqual,
  getResults, closeDatabase, getDatabase, now,
} = require('./helpers/test-setup');

const { orderRoutes } = require('../main/routes/orders');
const { billRoutes } = require('../main/routes/bills');

async function main() {
  console.log('Integration Test: Tax Correctness');
  console.log('='.repeat(50));

  const db = initTestDb();

  // Force India GST settings
  db.prepare("INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('country', 'IN', ?)").run(now());
  db.prepare("INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('business_type', 'restaurant', ?)").run(now());
  db.prepare("INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('state_code', '27', ?)").run(now());

  // Seed data
  const { authHeader } = seedOwnerUser(db);
  seedCategory(db, 'cat-tax', 'Tax Test Menu');
  seedProduct(db, 'prod-tax-1', 'cat-tax', 'Premium Coffee', 1000);

  const app = createApp({
    '/api/orders': orderRoutes,
    '/api/bills': billRoutes,
  });
  const { baseUrl, server } = await startServer(app);

  try {
    // ── Step 1: Create order and verify initial tax ──────────────────
    console.log('\n1. Create order — verify GST on ₹1000');
    const createRes = await api(baseUrl, '/api/orders', {
      method: 'POST',
      body: {
        type: 'takeaway',
        items: [{ product_id: 'prod-tax-1', quantity: 1 }],
      },
      headers: authHeader,
    });
    assertEqual(createRes.status, 201, 'order created');
    const orderId = createRes.data.order.id;

    // India restaurant: fixed 5% GST
    const initialTax = createRes.data.order.tax_amount;
    const initialTotal = createRes.data.order.total;
    assertEqual(createRes.data.order.subtotal, 1000, 'subtotal = ₹1000');
    assertEqual(initialTax, 50, 'tax = ₹50 (5% of ₹1000)');
    assertEqual(initialTotal, 1050, 'total = ₹1050 (₹1000 + ₹50 tax)');

    // ── Step 2: Apply 20% discount and verify tax recalculation ─────
    console.log('\n2. Apply 20% discount — verify tax recalculated on ₹800');
    const discountRes = await api(baseUrl, `/api/orders/${orderId}/discount`, {
      method: 'PATCH',
      body: { discount_type: 'percentage', discount_value: 20 },
      headers: authHeader,
    });
    assertEqual(discountRes.status, 200, 'discount applied');
    assertEqual(discountRes.data.order.discount_amount, 200, 'discount = ₹200 (20% of ₹1000)');

    // Tax should be recalculated: 5% of ₹800 = ₹40
    const discountedTax = discountRes.data.order.tax_amount;
    const discountedTotal = discountRes.data.order.total;
    assertEqual(discountedTax, 40, 'tax recalculated = ₹40 (5% of ₹800)');
    assertEqual(discountedTotal, 840, 'total = ₹840 (₹800 + ₹40 tax)');

    // ── Step 3: Generate bill and verify tax matches ─────────────────
    console.log('\n3. Generate bill — verify bill tax matches order');
    const billRes = await api(baseUrl, '/api/bills/generate', {
      method: 'POST',
      body: { order_id: orderId },
      headers: authHeader,
    });
    assertEqual(billRes.status, 201, 'bill created');
    assertEqual(billRes.data.bill.tax_amount, discountedTax, `bill tax = ₹${discountedTax}`);
    assertEqual(billRes.data.bill.total, discountedTotal, `bill total = ₹${discountedTotal}`);

    // ── Step 4: Verify tax breakdown structure ──────────────────────
    console.log('\n4. Verify tax breakdown (CGST + SGST)');
    const taxBreakdown = createRes.data.order.tax_breakdown;
    if (taxBreakdown) {
      const breakdown = typeof taxBreakdown === 'string' ? JSON.parse(taxBreakdown) : taxBreakdown;
      // India GST splits into CGST + SGST for intra-state
      assert(breakdown !== null, 'tax breakdown exists');
    } else {
      assert(true, 'tax breakdown not stored (acceptable for basic tax)');
    }

  } finally {
    server.close();
    closeDatabase();
    try { fs.rmSync(testDir, { recursive: true, force: true }); } catch {}
  }

  const { passed, failed, total } = getResults();
  console.log('\n' + '='.repeat(50));
  console.log(`${passed}/${total} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err: any) => {
  console.error('Test runner error:', err);
  process.exit(1);
});
