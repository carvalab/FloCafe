/**
 * Loyalty Toggle Tests
 *
 * Verifies that:
 * 1. Loyalty settings exist in the database after migration
 * 2. PATCH /api/orders/:id/loyalty endpoint works
 * 3. PATCH returns 404 for missing orders
 *
 * Uses Electron runtime (via run-electron-node-test.cjs) because
 * better-sqlite3 is built for Electron's Node ABI.
 *
 * Usage: node tests/run-electron-node-test.cjs tests/loyalty-toggle.test.ts
 */

const Module = require('module');
const originalLoad = Module._load;
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

// Mock electron before any imports that reference it
const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flo-loyalty-toggle-'));
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

const express = require('express');
const { initDatabase, getDatabase, closeDatabase, now } = require('../main/db');
const { orderRoutes } = require('../main/routes/orders');

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

function assertIncludes(haystack: string, needle: string, message: string) {
  total++;
  if (haystack.includes(needle)) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    console.error(`  ✗ ${message} — "${haystack}" does not contain "${needle}"`);
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
  const response = await (globalThis as any).fetch(baseUrl + urlPath, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  });
  const data = await response.json();
  return { status: response.status, data };
}

function isNativeAbiMismatch(error: any): boolean {
  return (
    error?.code === 'ERR_DLOPEN_FAILED' &&
    String(error?.message || '').includes('NODE_MODULE_VERSION')
  );
}

// ── Expected loyalty settings ─────────────────────────────────────────────────

const EXPECTED_LOYALTY_SETTINGS: Record<string, string> = {
  loyalty_enabled: '1',
  loyalty_points_per_currency: '1',
  loyalty_redemption_rate: '100',
  loyalty_max_balance_enabled: '0',
  loyalty_max_balance_points: '10000',
  loyalty_expiry_enabled: '0',
  loyalty_expiry_months: '6',
  loyalty_min_redemption: '100',
  loyalty_max_redemption_percentage: '50',
};

// ── Setup ─────────────────────────────────────────────────────────────────────

function seedTestData() {
  const db = getDatabase();

  // Create a product for order items
  db.prepare(
    `INSERT INTO categories (id, name, sort_order) VALUES (?, ?, ?)`
  ).run('cat-loyalty', 'Test', 1);
  db.prepare(
    `INSERT INTO products (id, category_id, name, price, is_active, sort_order) VALUES (?, ?, ?, ?, ?, ?)`
  ).run('prod-loyalty', 'cat-loyalty', 'Test Item', 100, 1, 1);

  // Create an order
  db.prepare(
    `INSERT INTO orders (order_number, table_id, type, status, subtotal, total, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run('ORD-LOYALTY-001', null, 'takeaway', 'pending', 100, 100, now(), now());
  const orderId = (db.prepare('SELECT id FROM orders WHERE order_number = ?').get('ORD-LOYALTY-001') as any).id;

  db.prepare(
    `INSERT INTO order_items (order_id, product_id, product_name, unit_price, quantity, subtotal, tax_amount, total, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(orderId, 'prod-loyalty', 'Test Item', 100, 1, 100, 0, 100, 'pending', now(), now());

  return orderId;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('Loyalty Toggle Tests');
  console.log('='.repeat(50));

  // Init database
  try {
    initDatabase();
  } catch (error: any) {
    if (isNativeAbiMismatch(error)) {
      console.log('  ⚠ Skipping: better-sqlite3 ABI mismatch (run via Electron)');
      process.exit(0);
    }
    throw error;
  }

  const testOrderId = seedTestData();

  // Start Express server
  const app = express();
  app.use(express.json());
  app.use('/api/orders', orderRoutes);
  const server = await listen(app);
  const addr = server.address() as any;
  const baseUrl = `http://127.0.0.1:${addr.port}`;

  try {
    // ── Test 1: Loyalty settings exist in database ──────────────────────
    console.log('\n1. Loyalty settings exist in database');
    {
      const db = getDatabase();
      for (const [key, expectedValue] of Object.entries(EXPECTED_LOYALTY_SETTINGS)) {
        const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as any;
        assert(row !== undefined, `setting "${key}" exists`);
        if (row) {
          assertEqual(row.value, expectedValue, `setting "${key}" has value "${expectedValue}"`);
        }
      }
    }

    // ── Test 2: PATCH endpoint enables loyalty on an order ──────────────
    console.log('\n2. PATCH /api/orders/:id/loyalty enables loyalty');
    {
      const res = await request(baseUrl, `/api/orders/${testOrderId}/loyalty`, {
        method: 'PATCH',
        body: JSON.stringify({ loyalty_enabled: true }),
      });
      assertEqual(res.status, 200, 'returns 200');
      assertEqual(res.data.success, true, 'response has success: true');
      assertEqual(res.data.loyalty_enabled, true, 'response has loyalty_enabled: true');
    }

    // ── Test 3: PATCH endpoint disables loyalty on an order ─────────────
    console.log('\n3. PATCH /api/orders/:id/loyalty disables loyalty');
    {
      const res = await request(baseUrl, `/api/orders/${testOrderId}/loyalty`, {
        method: 'PATCH',
        body: JSON.stringify({ loyalty_enabled: false }),
      });
      assertEqual(res.status, 200, 'returns 200');
      assertEqual(res.data.success, true, 'response has success: true');
      assertEqual(res.data.loyalty_enabled, false, 'response has loyalty_enabled: false');
    }

    // ── Test 4: PATCH returns 404 for missing order ────────────────────
    console.log('\n4. PATCH returns 404 for missing order');
    {
      const res = await request(baseUrl, '/api/orders/99999/loyalty', {
        method: 'PATCH',
        body: JSON.stringify({ loyalty_enabled: true }),
      });
      assertEqual(res.status, 404, 'returns 404');
      assertIncludes(res.data.error, 'Order not found', 'error mentions Order not found');
    }
  } finally {
    server.close();
    closeDatabase();
  }

  // Cleanup
  try {
    fs.rmSync(testDir, { recursive: true, force: true });
  } catch {}

  console.log('\n' + '='.repeat(50));
  console.log(`${passed}/${total} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('Test runner error:', err);
  process.exit(1);
});
