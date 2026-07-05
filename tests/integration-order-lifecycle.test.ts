/**
 * Integration Test: Order Lifecycle
 *
 * Tests order status transitions and the cancel-with-PIN flow:
 * A) Normal lifecycle: pending → preparing → ready → served → completed
 * B) Cancel requires manager PIN after pending
 * C) Pending cancel needs no PIN
 *
 * Usage: node tests/run-electron-node-test.cjs tests/integration-order-lifecycle.test.ts
 */

// ── Electron Mock ────────────────────────────────────────────────────────────
const Module = require('module');
const originalLoad = Module._load;
const fs = require('fs');
const os = require('os');
const path = require('path');
const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flo-lifecycle-'));
Module._load = function (request: string, parent: unknown, isMain: boolean) {
  if (request === 'electron') return { app: { isPackaged: true, getPath: () => testDir, getVersion: () => 'test' } };
  return originalLoad.apply(this, arguments as any);
};

const {
  initTestDb, createApp, startServer,
  seedOwnerUser, seedManagerUser, seedCategory, seedProduct, seedTable,
  api, assert, assertEqual, assertIncludes,
  getResults, closeDatabase, getDatabase, now,
} = require('./helpers/test-setup');

const { orderRoutes } = require('../main/routes/orders');
const { billRoutes } = require('../main/routes/bills');

async function main() {
  console.log('Integration Test: Order Lifecycle');
  console.log('='.repeat(50));

  const db = initTestDb();

  // Seed data
  const { authHeader } = seedOwnerUser(db);
  const manager = seedManagerUser(db);
  seedCategory(db, 'cat-life', 'Lifecycle Test Menu');
  seedProduct(db, 'prod-life-1', 'cat-life', 'Pasta', 400);
  seedTable(db, 'tbl-life-1', 1, 4);

  const app = createApp({
    '/api/orders': orderRoutes,
    '/api/bills': billRoutes,
  });
  const { baseUrl, server } = await startServer(app);

  try {
    // ═══════════════════════════════════════════════════════════════════
    // Scenario A: Normal Lifecycle
    // ═══════════════════════════════════════════════════════════════════
    console.log('\n─── Scenario A: Normal Lifecycle ───');

    // Create order
    const createRes = await api(baseUrl, '/api/orders', {
      method: 'POST',
      body: {
        type: 'dine_in',
        table_id: 'tbl-life-1',
        items: [{ product_id: 'prod-life-1', quantity: 1 }],
      },
      headers: authHeader,
    });
    assertEqual(createRes.status, 201, 'order created');
    const orderId = createRes.data.order.id;
    assertEqual(createRes.data.order.status, 'pending', 'initial status = pending');

    // Move to preparing
    const prepRes = await api(baseUrl, `/api/orders/${orderId}/status`, {
      method: 'PATCH',
      body: { status: 'preparing' },
      headers: authHeader,
    });
    assertEqual(prepRes.status, 200, 'moved to preparing');
    assertEqual(prepRes.data.order.status, 'preparing', 'status = preparing');
    assert(prepRes.data.order.cooking_started_at !== null, 'cooking_started_at is set');

    // Move to ready
    const readyRes = await api(baseUrl, `/api/orders/${orderId}/status`, {
      method: 'PATCH',
      body: { status: 'ready' },
      headers: authHeader,
    });
    assertEqual(readyRes.status, 200, 'moved to ready');
    assertEqual(readyRes.data.order.status, 'ready', 'status = ready');

    // Move to served
    const servedRes = await api(baseUrl, `/api/orders/${orderId}/status`, {
      method: 'PATCH',
      body: { status: 'served' },
      headers: authHeader,
    });
    assertEqual(servedRes.status, 200, 'moved to served');
    assertEqual(servedRes.data.order.status, 'served', 'status = served');

    // Generate bill and pay → should complete order
    const billRes = await api(baseUrl, '/api/bills/generate', {
      method: 'POST',
      body: { order_id: orderId },
      headers: authHeader,
    });
    const payRes = await api(baseUrl, `/api/bills/${billRes.data.bill.id}/payment`, {
      method: 'POST',
      body: { method: 'cash', amount: billRes.data.bill.total },
      headers: authHeader,
    });
    assertEqual(payRes.status, 200, 'payment accepted');

    // Verify order completed and table freed
    const finalOrder = await api(baseUrl, `/api/orders/${orderId}`, { headers: authHeader });
    assertEqual(finalOrder.data.order.status, 'completed', 'order status = completed after payment');

    // ═══════════════════════════════════════════════════════════════════
    // Scenario B: Cancel Requires Manager PIN After Pending
    // ═══════════════════════════════════════════════════════════════════
    console.log('\n─── Scenario B: Cancel Requires PIN After Pending ───');

    // Create order and move to preparing
    const orderB = await api(baseUrl, '/api/orders', {
      method: 'POST',
      body: { type: 'takeaway', items: [{ product_id: 'prod-life-1', quantity: 1 }] },
      headers: authHeader,
    });
    const orderBId = orderB.data.order.id;
    await api(baseUrl, `/api/orders/${orderBId}/status`, {
      method: 'PATCH',
      body: { status: 'preparing' },
      headers: authHeader,
    });

    // Try to cancel without PIN — should fail
    const cancelNoPin = await api(baseUrl, `/api/orders/${orderBId}/status`, {
      method: 'PATCH',
      body: { status: 'cancelled' },
      headers: authHeader,
    });
    assertEqual(cancelNoPin.status, 400, 'cancel without PIN returns 400');
    assertIncludes(cancelNoPin.data.error, 'PIN', 'error mentions PIN requirement');

    // Cancel with correct manager PIN — should succeed
    const cancelWithPin = await api(baseUrl, `/api/orders/${orderBId}/status`, {
      method: 'PATCH',
      body: { status: 'cancelled', override_pin: '1234' },
      headers: authHeader,
    });
    assertEqual(cancelWithPin.status, 200, 'cancel with correct PIN returns 200');
    assertEqual(cancelWithPin.data.order.status, 'cancelled', 'order cancelled');

    // Try with wrong PIN — should fail
    const orderB2 = await api(baseUrl, '/api/orders', {
      method: 'POST',
      body: { type: 'takeaway', items: [{ product_id: 'prod-life-1', quantity: 1 }] },
      headers: authHeader,
    });
    await api(baseUrl, `/api/orders/${orderB2.data.order.id}/status`, {
      method: 'PATCH',
      body: { status: 'preparing' },
      headers: authHeader,
    });
    const cancelWrongPin = await api(baseUrl, `/api/orders/${orderB2.data.order.id}/status`, {
      method: 'PATCH',
      body: { status: 'cancelled', override_pin: '9999' },
      headers: authHeader,
    });
    assertEqual(cancelWrongPin.status, 403, 'cancel with wrong PIN returns 403');

    // ═══════════════════════════════════════════════════════════════════
    // Scenario C: Pending Cancel Needs No PIN
    // ═══════════════════════════════════════════════════════════════════
    console.log('\n─── Scenario C: Pending Cancel Needs No PIN ───');

    const orderC = await api(baseUrl, '/api/orders', {
      method: 'POST',
      body: { type: 'takeaway', items: [{ product_id: 'prod-life-1', quantity: 1 }] },
      headers: authHeader,
    });
    const cancelPending = await api(baseUrl, `/api/orders/${orderC.data.order.id}/status`, {
      method: 'PATCH',
      body: { status: 'cancelled' },
      headers: authHeader,
    });
    assertEqual(cancelPending.status, 200, 'pending cancel without PIN returns 200');
    assertEqual(cancelPending.data.order.status, 'cancelled', 'order cancelled');

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
