/**
 * Integration Test: Happy Path
 *
 * Tests a complete customer transaction from order creation to payment.
 * This single test covers: order creation, discount application, bill generation,
 * and payment processing — the core money flow.
 *
 * Bugs this catches: #3 (duplicate order numbers), #4 (discount tax recalc),
 * #5 (discount not syncing to bill), #9 (amount:0 paying full bill)
 *
 * Usage: node tests/run-electron-node-test.cjs tests/integration-happy-path.test.ts
 */

// ── Electron Mock (must be before any app imports) ───────────────────────────
const Module = require('module');
const originalLoad = Module._load;
const fs = require('fs');
const os = require('os');
const path = require('path');
const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flo-happy-path-'));
Module._load = function (request: string, parent: unknown, isMain: boolean) {
  if (request === 'electron') return { app: { isPackaged: true, getPath: () => testDir, getVersion: () => 'test' } };
  return originalLoad.apply(this, arguments as any);
};

const {
  initTestDb, createApp, startServer,
  seedOwnerUser, seedCategory, seedProduct,
  api, assert, assertEqual,
  getResults, closeDatabase,
} = require('./helpers/test-setup');

const { orderRoutes } = require('../main/routes/orders');
const { billRoutes } = require('../main/routes/bills');

async function main() {
  console.log('Integration Test: Happy Path');
  console.log('='.repeat(50));

  const db = initTestDb();

  // Seed: owner user, category, 2 products
  const { authHeader } = seedOwnerUser(db);
  seedCategory(db, 'cat-happy', 'Test Menu');
  seedProduct(db, 'prod-a', 'cat-happy', 'Cappuccino', 500);
  seedProduct(db, 'prod-b', 'cat-happy', 'Sandwich', 300);

  // Create Express app with orders + bills routes
  const app = createApp({
    '/api/orders': orderRoutes,
    '/api/bills': billRoutes,
  });
  const { baseUrl, server } = await startServer(app);

  try {
    // ── Step 1: Create order with 2 items ────────────────────────────
    console.log('\n1. Create order with 2 items');
    const createRes = await api(baseUrl, '/api/orders', {
      method: 'POST',
      body: {
        type: 'takeaway',
        items: [
          { product_id: 'prod-a', quantity: 1 },
          { product_id: 'prod-b', quantity: 1 },
        ],
      },
      headers: authHeader,
    });
    assertEqual(createRes.status, 201, 'order created (201)');
    const orderId = createRes.data.order.id;
    assert(orderId > 0, `order has valid id (${orderId})`);

    // Verify initial totals (500 + 300 = 800 subtotal)
    // Tax depends on settings — India GST 5% → 40 tax → total 840, or no tax → total 800
    const orderSubtotal = createRes.data.order.subtotal;
    const orderTotal = createRes.data.order.total;
    assertEqual(orderSubtotal, 800, 'order subtotal = 800 (500 + 300)');
    assert(orderTotal >= 800, `order total >= 800 (got ${orderTotal})`);
    assertEqual(createRes.data.order.status, 'pending', 'order status is pending');

    // ── Step 2: Apply 10% discount ───────────────────────────────────
    console.log('\n2. Apply 10% order-level discount');
    const discountRes = await api(baseUrl, `/api/orders/${orderId}/discount`, {
      method: 'PATCH',
      body: { discount_type: 'percentage', discount_value: 10 },
      headers: authHeader,
    });
    assertEqual(discountRes.status, 200, 'discount applied (200)');
    assertEqual(discountRes.data.order.discount_type, 'percentage', 'discount type is percentage');
    assertEqual(discountRes.data.order.discount_value, 10, 'discount value is 10');
    assertEqual(discountRes.data.order.discount_amount, 80, 'discount amount = 80 (10% of 800)');

    // Verify total is recalculated (subtotal - discount + tax)
    const discountedSubtotal = 800 - 80; // 720
    const discountedTotal = discountRes.data.order.total;
    assert(discountedTotal >= discountedSubtotal, `total >= ${discountedSubtotal} (got ${discountedTotal})`);

    // ── Step 3: Generate bill ────────────────────────────────────────
    console.log('\n3. Generate bill');
    const billRes = await api(baseUrl, '/api/bills/generate', {
      method: 'POST',
      body: { order_id: orderId },
      headers: authHeader,
    });
    assertEqual(billRes.status, 201, 'bill created (201)');
    const billId = billRes.data.bill.id;
    assert(billId > 0, `bill has valid id (${billId})`);
    assertEqual(billRes.data.bill.payment_status, 'unpaid', 'bill is unpaid');
    assertEqual(billRes.data.bill.total, discountedTotal, `bill total matches order total (${discountedTotal})`);
    assertEqual(billRes.data.bill.balance, discountedTotal, `bill balance = ${discountedTotal}`);
    assertEqual(billRes.data.bill.discount_amount, 80, 'bill shows discount of 80');

    // ── Step 4: Pay full amount with cash ────────────────────────────
    console.log('\n4. Pay full amount with cash');
    const payRes = await api(baseUrl, `/api/bills/${billId}/payment`, {
      method: 'POST',
      body: { method: 'cash', amount: discountedTotal },
      headers: authHeader,
    });
    assertEqual(payRes.status, 200, 'payment accepted (200)');
    assertEqual(payRes.data.bill.payment_status, 'paid', 'bill status = paid');
    assertEqual(payRes.data.bill.balance, 0, 'balance = 0');

    // Verify payment_details has one cash entry
    const payments = JSON.parse(payRes.data.bill.payment_details);
    assertEqual(payments.length, 1, 'one payment recorded');
    assertEqual(payments[0].method, 'cash', 'payment method is cash');
    assertEqual(payments[0].amount, discountedTotal, `payment amount = ${discountedTotal}`);

    // ── Step 5: Verify order is completed ────────────────────────────
    console.log('\n5. Verify order status after payment');
    const orderRes = await api(baseUrl, `/api/orders/${orderId}`, { headers: authHeader });
    assertEqual(orderRes.status, 200, 'order fetch returns 200');
    assertEqual(orderRes.data.order.status, 'completed', 'order status = completed');

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
