/**
 * Integration Test: Issue #125 — read paths prefer normalized order_item_addons
 *
 * Migration v25 (order_item_addons table + backfill) and the order-creation
 * dual-write were already done (see tests/order-item-addons.test.ts). This
 * covers the remaining piece: read paths must PREFER the normalized table
 * over the addons JSON column, falling back to JSON only when no normalized
 * rows exist (legacy pre-dual-write data).
 *
 * "Prefer" is proven, not assumed: after creating an order (which dual-writes
 * both), the JSON column is deliberately overwritten with different data —
 * if a read path still returns the *original* normalized values, it's
 * genuinely reading order_item_addons, not just happening to agree with JSON.
 *
 * Usage: node tests/run-electron-node-test.cjs tests/issue-125-addon-read-paths.test.ts
 */

const Module = require('module');
const originalLoad = Module._load;
const fs = require('fs');
const os = require('os');
const path = require('path');
const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flo-issue-125-'));
Module._load = function (request: string, parent: unknown, isMain: boolean) {
  if (request === 'electron') return { app: { isPackaged: true, getPath: () => testDir, getVersion: () => 'test' } };
  return originalLoad.apply(this, arguments as any);
};

process.env.JWT_SECRET = 'test-secret-issue-125';

const {
  initTestDb, createApp, startServer,
  seedOwnerUser, seedCategory, seedProduct,
  api, assert, assertEqual, getResults, closeDatabase, getDatabase,
} = require('./helpers/test-setup');

const { orderRoutes } = require('../main/routes/orders');
const { kdsRoutes } = require('../main/routes/kds');
const { attachEffectiveAddons, now } = require('../main/db');

async function main() {
  console.log('Integration Test: Issue #125 — addon read paths prefer normalized table');
  console.log('='.repeat(60));

  const db = initTestDb();
  const { authHeader } = seedOwnerUser(db);
  seedCategory(db, 'cat-125', 'Food');
  seedProduct(db, 'prod-125', 'cat-125', 'Tea', 50);
  db.prepare(`INSERT INTO addon_groups (id, name) VALUES ('ag-125', 'Extras')`).run();
  db.prepare(`INSERT INTO addons (id, addon_group_id, name, price, is_active) VALUES ('addon-125-sugar', 'ag-125', 'Extra Sugar', 5, 1)`).run();

  const app = createApp({ '/api/orders': orderRoutes, '/api/kds': kdsRoutes });
  const { baseUrl, server } = await startServer(app);

  try {
    let orderId: number;
    let itemId: number;

    console.log('\n─── Setup: create an order with an addon (dual-writes both places) ───');
    {
      const res = await api(baseUrl, '/api/orders', {
        method: 'POST',
        body: { type: 'takeaway', items: [{ product_id: 'prod-125', quantity: 1, addons: [{ id: 'addon-125-sugar', name: 'Extra Sugar', price: 5 }] }] },
        headers: authHeader,
      });
      assertEqual(res.status, 201, 'order created');
      orderId = res.data.order.id;
      itemId = (db.prepare('SELECT id FROM order_items WHERE order_id = ?').get(orderId) as any).id;

      const normalizedRows = db.prepare('SELECT * FROM order_item_addons WHERE order_item_id = ?').all(itemId);
      assertEqual(normalizedRows.length, 1, 'setup: normalized row exists (dual-write confirmed)');
    }

    console.log('\n─── Scenario A: GET /:id genuinely prefers the normalized table over JSON ───');
    {
      // Deliberately corrupt the JSON column to something different — if a
      // read path still shows "Extra Sugar", it can only be reading
      // order_item_addons, since the JSON now says something else entirely.
      db.prepare('UPDATE order_items SET addons = ? WHERE id = ?').run(
        JSON.stringify([{ id: 'stale-json-addon', name: 'STALE JSON VALUE', price: 999 }]),
        itemId
      );

      const res = await api(baseUrl, `/api/orders/${orderId}`, { headers: authHeader });
      assertEqual(res.status, 200, 'A: order detail fetched');
      const addons = res.data.order.items[0].addons;
      assertEqual(addons.length, 1, 'A: exactly one addon returned');
      assertEqual(addons[0].name, 'Extra Sugar', 'A: returns the NORMALIZED addon name, not the corrupted JSON value');
      assertEqual(addons[0].price, 5, 'A: returns the normalized price, not the corrupted 999');
    }

    console.log('\n─── Scenario B: GET / (list) also prefers the normalized table ───');
    {
      const res = await api(baseUrl, '/api/orders', { headers: authHeader });
      assertEqual(res.status, 200, 'B: order list fetched');
      const order = res.data.orders.find((o: any) => o.id === orderId);
      assert(!!order, 'B: order found in list');
      assertEqual(order.items[0].addons[0].name, 'Extra Sugar', 'B: list view also shows the normalized value, not the stale JSON');
    }

    console.log('\n─── Scenario C: KDS GET /orders also prefers the normalized table ───');
    {
      const res = await api(baseUrl, '/api/kds/orders', { headers: authHeader });
      assertEqual(res.status, 200, 'C: kds orders fetched');
      const order = res.data.orders.find((o: any) => o.id === orderId);
      assert(!!order, 'C: order found on KDS feed');
      const item = order.items.find((i: any) => i.id === itemId);
      assert(!!item, 'C: item found on the order');
      const addons = typeof item.addons === 'string' ? JSON.parse(item.addons) : item.addons;
      assertEqual(addons[0].name, 'Extra Sugar', 'C: KDS /orders shows the normalized value, not stale JSON');
    }

    console.log('\n─── Scenario D: legacy item with no normalized rows falls back to JSON ───');
    {
      db.prepare(
        `INSERT INTO orders (order_number, type, status, subtotal, total, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run('ORD-125-LEGACY', 'takeaway', 'active', 55, 55, now(), now());
      const legacyOrderId = (db.prepare('SELECT id FROM orders WHERE order_number = ?').get('ORD-125-LEGACY') as any).id;
      db.prepare(
        `INSERT INTO order_items (order_id, product_id, product_name, unit_price, quantity, subtotal, tax_amount, total, addons, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(legacyOrderId, 'prod-125', 'Tea', 50, 1, 55, 0, 55, JSON.stringify([{ id: 'addon-125-sugar', name: 'Extra Sugar', price: 5 }]), 'active', now(), now());
      // No order_item_addons rows inserted — simulates pre-dual-write data.

      const res = await api(baseUrl, `/api/orders/${legacyOrderId}`, { headers: authHeader });
      assertEqual(res.status, 200, 'D: legacy order detail fetched');
      const addons = res.data.order.items[0].addons;
      assert(Array.isArray(addons) && addons.length === 1, 'D: falls back to parsing the JSON column');
      assertEqual(addons[0].name, 'Extra Sugar', 'D: legacy JSON-only addon still shows correctly');
    }

    console.log('\n─── Scenario E: attachEffectiveAddons unit behavior ───');
    {
      const noNormalized = attachEffectiveAddons(db, [{ id: itemId + 99999, addons: JSON.stringify([{ name: 'X' }]) }]);
      assertEqual(noNormalized[0].addons[0].name, 'X', 'E: item with zero normalized rows parses its JSON string');

      const nullAddons = attachEffectiveAddons(db, [{ id: itemId + 99998, addons: null }]);
      assertEqual(nullAddons[0].addons, null, 'E: item with null addons and no normalized rows stays null');

      const malformedJson = attachEffectiveAddons(db, [{ id: itemId + 99997, addons: '{not valid json' }]);
      assertEqual(malformedJson[0].addons, null, 'E: malformed JSON with no normalized rows degrades to null, not a throw');

      const empty = attachEffectiveAddons(db, []);
      assertEqual(empty.length, 0, 'E: empty input array returns empty array without querying');
    }

  } finally {
    server.close();
    closeDatabase();
    fs.rmSync(testDir, { recursive: true, force: true });
  }

  const { passed, failed, total } = getResults();
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Results: ${passed}/${total} passed, ${failed} failed`);
  if (failed > 0) {
    console.error('FAILED');
    process.exit(1);
  } else {
    console.log('ALL PASSED');
  }
}

main().catch((err) => {
  console.error('Test crashed:', err);
  process.exit(1);
});
