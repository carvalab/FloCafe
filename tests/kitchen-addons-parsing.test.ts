/**
 * Kitchen Orders — Addons Parsing Test
 *
 * Verifies that the /api/kitchen/orders endpoint returns addons as a
 * parsed array, not a raw JSON string. This catches regressions where
 * SQLite TEXT columns are returned unparsed, causing
 * "e.addons.map is not a function" on the KDS frontend.
 *
 * Also verifies the round-trip: order creation stores addons as JSON
 * string, kitchen endpoint returns them as a parsed array.
 *
 * Usage: node tests/run-electron-node-test.cjs tests/kitchen-addons-parsing.test.ts
 */

const Module = require('module');
const originalLoad = Module._load;
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flo-kitchen-addons-'));
const mockApp = {
  isPackaged: true,
  getPath: (name: string) => {
    if (name === 'userData') return testDir;
    if (name === 'documents') return testDir;
    return testDir;
  },
  getVersion: () => 'test',
};

Module._load = function (request: string, parent: unknown, isMain: boolean) {
  if (request === 'electron') return { app: mockApp };
  return originalLoad.apply(this, arguments as any);
};

process.env.JWT_SECRET = 'test-secret-kitchen-addons';

const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { initDatabase, getDatabase, closeDatabase, now } = require('../main/db');
const { getJWTSecret } = require('../main/routes/auth');
const { kitchenRoutes } = require('../main/routes/kitchen');

// ── Test Helpers ──────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
let total = 0;

function assert(condition: boolean, message: string) {
  total++;
  if (condition) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    console.error(`  ✗ ${message}`);
  }
}

function assertEqual(actual: any, expected: any, message: string) {
  total++;
  if (actual === expected) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    console.error(`  ✗ ${message} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

async function listen(app: any): Promise<http.Server> {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1');
    server.once('error', reject);
    server.once('listening', () => resolve(server));
  });
}

async function request(
  baseUrl: string,
  urlPath: string,
  options: Record<string, any> = {}
): Promise<{ status: number; data: any }> {
  const fetchOptions: any = {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
  };
  if (options.method) fetchOptions.method = options.method;
  if (options.body) fetchOptions.body = options.body;

  const response = await (globalThis as any).fetch(baseUrl + urlPath, fetchOptions);
  const data = await response.json();
  return { status: response.status, data };
}

function isNativeAbiMismatch(error: any): boolean {
  return (
    error?.code === 'ERR_DLOPEN_FAILED' &&
    String(error?.message || '').includes('NODE_MODULE_VERSION')
  );
}

// ── Seed ──────────────────────────────────────────────────────────────────────

function seedTestData() {
  const db = getDatabase();

  // Owner user
  const ownerId = 'owner-addons-test';
  db.prepare(
    `INSERT INTO users (id, name, email, password, role, is_active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    ownerId, 'Test Owner', 'owner@test.local',
    bcrypt.hashSync('password', 10), 'owner', 1, now(), now()
  );

  // Category + product
  db.prepare(`INSERT INTO categories (id, name, sort_order) VALUES (?, ?, ?)`)
    .run('cat-addons', 'Test', 1);
  db.prepare(
    `INSERT INTO products (id, category_id, name, price, is_active, sort_order) VALUES (?, ?, ?, ?, ?, ?)`
  ).run('prod-addons', 'cat-addons', 'Burger', 200, 1, 1);

  // Order with addons stored as JSON string (how the orders API stores it)
  const addonsArray = [
    { id: 1, name: 'Extra Cheese', price: 50 },
    { id: 2, name: 'Bacon', price: 80 },
  ];
  const addonsJson = JSON.stringify(addonsArray);

  db.prepare(
    `INSERT INTO orders (order_number, table_id, type, status, subtotal, total, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run('ORD-ADDONS-001', null, 'takeaway', 'preparing', 330, 330, now(), now());

  const orderId = (db.prepare('SELECT id FROM orders WHERE order_number = ?').get('ORD-ADDONS-001') as any).id;

  // Insert order_item with addons as JSON string (mimics what the orders API does)
  db.prepare(
    `INSERT INTO order_items (order_id, product_id, product_name, unit_price, quantity,
      subtotal, tax_amount, total, addons, special_instructions, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(orderId, 'prod-addons', 'Burger', 200, 1, 330, 0, 330, addonsJson, 'No pickles', 'preparing', now(), now());

  // Order with null addons
  db.prepare(
    `INSERT INTO orders (order_number, table_id, type, status, subtotal, total, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run('ORD-ADDONS-002', null, 'takeaway', 'pending', 200, 200, now(), now());

  const orderId2 = (db.prepare('SELECT id FROM orders WHERE order_number = ?').get('ORD-ADDONS-002') as any).id;
  db.prepare(
    `INSERT INTO order_items (order_id, product_id, product_name, unit_price, quantity,
      subtotal, tax_amount, total, addons, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(orderId2, 'prod-addons', 'Burger', 200, 1, 200, 0, 200, null, 'pending', now(), now());

  // Order with empty array addons (stored as "[]")
  db.prepare(
    `INSERT INTO orders (order_number, table_id, type, status, subtotal, total, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run('ORD-ADDONS-003', null, 'takeaway', 'ready', 200, 200, now(), now());

  const orderId3 = (db.prepare('SELECT id FROM orders WHERE order_number = ?').get('ORD-ADDONS-003') as any).id;
  db.prepare(
    `INSERT INTO order_items (order_id, product_id, product_name, unit_price, quantity,
      subtotal, tax_amount, total, addons, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(orderId3, 'prod-addons', 'Burger', 200, 1, 200, 0, 200, '[]', 'ready', now(), now());
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('Kitchen Orders — Addons Parsing');
  console.log('='.repeat(50));

  try {
    initDatabase();
  } catch (error: any) {
    if (isNativeAbiMismatch(error)) {
      console.log('  ⚠ Skipping: better-sqlite3 ABI mismatch (run via Electron)');
      process.exit(77);
    }
    throw error;
  }

  seedTestData();

  const app = express();
  app.use(express.json());

  // Auth middleware
  app.use((req: any, res: any, next: any) => {
    if (!req.path.startsWith('/api')) { next(); return; }
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }
    try {
      const payload = jwt.verify(authHeader.split(' ')[1], getJWTSecret());
      req.user = payload;
      next();
    } catch {
      res.status(401).json({ error: 'Invalid or expired token' });
    }
  });

  app.use('/api/kitchen', kitchenRoutes);
  const server = await listen(app);
  const addr = server.address() as any;
  const baseUrl = `http://127.0.0.1:${addr.port}`;

  const token = jwt.sign(
    { userId: 'owner-addons-test', email: 'owner@test.local', role: 'owner' },
    getJWTSecret(),
    { expiresIn: '1h' }
  );
  const authHeader = `Bearer ${token}`;

  try {
    // ── Test 1: Kitchen returns addons as array ────────────────────────
    console.log('\n1. Kitchen orders returns addons as parsed array');
    {
      const res = await request(baseUrl, '/api/kitchen/orders', {
        headers: { Authorization: authHeader },
      });
      assertEqual(res.status, 200, 'returns 200');

      const order1 = res.data.orders.find((o: any) => o.order_number === 'ORD-ADDONS-001');
      assert(!!order1, 'found order with addons');
      const item1 = order1?.items?.[0];
      assert(!!item1, 'order has an item');

      // Critical: addons must be an array, not a string
      assert(Array.isArray(item1?.addons), 'addons is an array (not a string)');
      assertEqual(item1?.addons?.length, 2, 'addons has 2 entries');
      assertEqual(item1?.addons?.[0]?.name, 'Extra Cheese', 'first addon name is correct');
      assertEqual(item1?.addons?.[1]?.price, 80, 'second addon price is correct');
    }

    // ── Test 2: Null addons stays null ─────────────────────────────────
    console.log('\n2. Null addons remains null/falsy');
    {
      const res = await request(baseUrl, '/api/kitchen/orders', {
        headers: { Authorization: authHeader },
      });
      const order2 = res.data.orders.find((o: any) => o.order_number === 'ORD-ADDONS-002');
      const item2 = order2?.items?.[0];
      assert(!item2?.addons, 'null addons is falsy');
    }

    // ── Test 3: Empty array addons ─────────────────────────────────────
    console.log('\n3. Empty array addons is parsed correctly');
    {
      const res = await request(baseUrl, '/api/kitchen/orders', {
        headers: { Authorization: authHeader },
      });
      const order3 = res.data.orders.find((o: any) => o.order_number === 'ORD-ADDONS-003');
      const item3 = order3?.items?.[0];
      assert(Array.isArray(item3?.addons), 'empty addons is an array');
      assertEqual(item3?.addons?.length, 0, 'empty addons has length 0');
    }

    // ── Test 4: special_instructions preserved ─────────────────────────
    console.log('\n4. Special instructions are preserved');
    {
      const res = await request(baseUrl, '/api/kitchen/orders', {
        headers: { Authorization: authHeader },
      });
      const order1 = res.data.orders.find((o: any) => o.order_number === 'ORD-ADDONS-001');
      const item1 = order1?.items?.[0];
      assertEqual(item1?.special_instructions, 'No pickles', 'special instructions preserved');
    }

  } finally {
    server.close();
    closeDatabase();
  }

  console.log('\n' + '='.repeat(50));
  console.log(`${passed}/${total} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Test crashed:', err);
  process.exit(1);
});
