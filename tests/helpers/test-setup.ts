/**
 * Shared test setup helper for integration tests.
 *
 * Provides reusable functions for:
 * - Creating Express apps with routes mounted
 * - Seeding test data (categories, products, users, customers)
 * - Generating JWT tokens for authenticated requests
 * - Making API requests
 * - Cleanup (server, database, temp directory)
 *
 * IMPORTANT: Each test file must mock Electron BEFORE importing this helper.
 * The Electron mock (Module._load override) must be the first thing that runs,
 * before any imports from main/*. Put this at the top of every test file:
 *
 *   const Module = require('module');
 *   const originalLoad = Module._load;
 *   const fs = require('fs');
 *   const os = require('os');
 *   const path = require('path');
 *   const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flo-test-'));
 *   Module._load = function(request, parent, isMain) {
 *     if (request === 'electron') return { app: { isPackaged: true, getPath: () => testDir, getVersion: () => 'test' }};
 *     return originalLoad.apply(this, arguments);
 *   };
 *
 * Usage:
 *   const { createApp, seed, api, cleanup, assert, assertEqual } = require('./helpers/test-setup');
 */

const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const http = require('http');
const fs = require('fs');
const { initDatabase, getDatabase, closeDatabase, now } = require('../../main/db');

// ── Assertion Helpers ────────────────────────────────────────────────────────

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
  if (haystack && haystack.includes(needle)) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    console.error(`  ✗ ${message} — "${haystack}" does not contain "${needle}"`);
  }
}

function assertGreaterThan(actual: number, expected: number, message: string) {
  total++;
  if (actual > expected) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    console.error(`  ✗ ${message} — expected > ${expected}, got ${actual}`);
  }
}

function getResults() {
  return { passed, failed, total };
}

function resetCounters() {
  passed = 0;
  failed = 0;
  total = 0;
}

// ── ABI Mismatch Check ───────────────────────────────────────────────────────

function isNativeAbiMismatch(error: any): boolean {
  return (
    error?.code === 'ERR_DLOPEN_FAILED' &&
    String(error?.message || '').includes('NODE_MODULE_VERSION')
  );
}

// ── Database Init ────────────────────────────────────────────────────────────

function initTestDb() {
  try {
    initDatabase();
  } catch (error: any) {
    if (isNativeAbiMismatch(error)) {
      console.log('  ⚠ Skipping: better-sqlite3 ABI mismatch (run via Electron)');
      process.exit(77); // exit code 77 = skip (GNU convention)
    }
    throw error;
  }
  return getDatabase();
}

/**
 * Installs and activates the country package that matches the current
 * `country` setting, so the tax engine for that country is reachable
 * for downstream order/bill/preview calls. This mirrors what
 * first-run setup would do in production: the merchant picks a country
 * and the matching tax pack becomes the source of truth.
 *
 * The proposal says "activation-aware" tax resolution, so a test that
 * wants to exercise the India GST engine must explicitly seed its
 * installation. This helper just removes the boilerplate.
 */
function seedCountryTaxPackage() {
  const { getDatabase } = require('../../main/db');
  const db = getDatabase();
  const row = db.prepare("SELECT value FROM settings WHERE key = 'country'").get() as { value: string } | undefined;
  const country = (row?.value || '').toUpperCase();
  if (!country) return null;
  const packageId = `country.${country.toLowerCase()}`;
  // Only the Stage 1 in-repo packages have a tax engine today.
  const known: Record<string, { version: string; permissions: string[] }> = {
    'country.in': { version: '1.0.0', permissions: ['settings.read', 'settings.write', 'payment.write', 'fiscal.write', 'delivery.events', 'broker.connect'] },
    'country.ar': { version: '1.0.0', permissions: ['settings.read', 'settings.write', 'payment.write', 'fiscal.write', 'delivery.events', 'broker.connect'] },
  };
  const pkg = known[packageId];
  if (!pkg) return null;
   const { installPackage, setInstallationStatus, setFeatureStatus } = require('../../main/plugins/installations');
   const existing = db.prepare('SELECT id FROM plugin_installations WHERE package_id = ?').get(packageId) as { id: string } | undefined;
   const id = existing?.id ?? installPackage({ packageId, packageVersion: pkg.version, grantedPermissions: pkg.permissions }).id;
   setInstallationStatus(id, 'activated');
   const capabilityId = packageId === 'country.in' ? 'tax.gst' : 'tax.iva';
   setFeatureStatus(id, capabilityId, 'active');
  return id;
}

// ── Express App Factory ──────────────────────────────────────────────────────

function createApp(routeModules: Record<string, any>, options?: { authRole?: string }) {
  const app = express();
  app.use(express.json());

  // Set JWT_SECRET for tests
  if (!process.env.JWT_SECRET) {
    process.env.JWT_SECRET = 'test-secret-' + Date.now();
  }

  const { getJWTSecret } = require('../../main/routes/auth');

  // Auth middleware — matches production behavior
  app.use((req: any, res: any, next: any) => {
    if (!req.path.startsWith('/api')) { next(); return; }
    if (req.path === '/api/health') { next(); return; }
    if (req.path.startsWith('/api/auth') && !req.path.includes('/api/auth/me')) { next(); return; }

    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }
    try {
      const payload = jwt.verify(authHeader.split(' ')[1], getJWTSecret());
      (req as any).user = payload;
      next();
    } catch {
      res.status(401).json({ error: 'Invalid or expired token' });
    }
  });

  // Mount route modules
  for (const [mountPath, router] of Object.entries(routeModules)) {
    app.use(mountPath, router);
  }

  return app;
}

// ── Server Lifecycle ─────────────────────────────────────────────────────────

async function startServer(app: any): Promise<{ baseUrl: string; server: any }> {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1');
    server.once('error', reject);
    server.once('listening', () => {
      const addr = server.address() as any;
      resolve({ baseUrl: `http://127.0.0.1:${addr.port}`, server });
    });
  });
}

// ── Seed Data Helpers ────────────────────────────────────────────────────────

function seedOwnerUser(db: any): { userId: string; token: string; authHeader: Record<string, string> } {
  const { getJWTSecret } = require('../../main/routes/auth');
  const userId = 'owner-test-001';
  const passwordHash = bcrypt.hashSync('testpass123', 10);

  db.prepare(
    `INSERT OR IGNORE INTO users (id, name, email, password, role, is_active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(userId, 'Test Owner', 'owner@test.local', passwordHash, 'owner', 1, now(), now());

  const { getSettingValue } = require('../../main/db');
  const { provisionBuiltinTaxPackage } = require('../../main/plugins/installations');
  provisionBuiltinTaxPackage(getSettingValue('country') || 'IN');

  const token = jwt.sign(
    { userId, email: 'owner@test.local', role: 'owner' },
    getJWTSecret(),
    { expiresIn: '1h' }
  );

  return { userId, token, authHeader: { Authorization: `Bearer ${token}` } };
}

function seedManagerUser(db: any): { userId: string; token: string; authHeader: Record<string, string> } {
  const { getJWTSecret } = require('../../main/routes/auth');
  const userId = 'mgr-test-001';
  const passwordHash = bcrypt.hashSync('testpass123', 10);
  const pinHash = bcrypt.hashSync('1234', 10);

  db.prepare(
    `INSERT OR IGNORE INTO users (id, name, email, password, role, pin_hash, is_active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(userId, 'Test Manager', 'manager@test.local', passwordHash, 'manager', pinHash, 1, now(), now());

  const token = jwt.sign(
    { userId, email: 'manager@test.local', role: 'manager' },
    getJWTSecret(),
    { expiresIn: '1h' }
  );

  return { userId, token, authHeader: { Authorization: `Bearer ${token}` } };
}

function seedCategory(db: any, id: string, name: string) {
  db.prepare(
    `INSERT OR IGNORE INTO categories (id, name, sort_order, is_active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(id, name, 1, 1, now(), now());
}

function seedProduct(db: any, id: string, categoryId: string, name: string, price: number, options?: {
  tax_type?: string;
  cb_percent?: number;
  track_inventory?: boolean;
  stock_quantity?: number;
}) {
  db.prepare(
    `INSERT OR IGNORE INTO products (id, category_id, name, price, tax_type, cb_percent, track_inventory, stock_quantity, is_active, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id, categoryId, name, price,
    options?.tax_type || 'gst',
    options?.cb_percent || 0,
    options?.track_inventory ? 1 : 0,
    options?.stock_quantity ?? 999,
    1, 1, now(), now()
  );
}

function seedCustomer(db: any, id: string, name: string, phone?: string) {
  db.prepare(
    `INSERT OR IGNORE INTO customers (id, name, phone, is_active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(id, name, phone || null, 1, now(), now());
}

function seedTable(db: any, id: string, number: number, capacity?: number) {
  db.prepare(
    `INSERT OR IGNORE INTO tables (id, number, capacity, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(id, number, capacity || 4, 'available', now(), now());
}

function seedWalletCredit(db: any, customerId: string, amount: number, billId?: number) {
  db.prepare(
    `INSERT INTO loyalty_ledger (customer_id, bill_id, type, amount, description, created_at, updated_at)
     VALUES (?, ?, 'credit', ?, ?, ?, ?)`
  ).run(customerId, billId || null, amount, 'Test wallet credit', now(), now());
}

// ── API Request Helper ───────────────────────────────────────────────────────

async function api(
  baseUrl: string,
  urlPath: string,
  options: {
    method?: string;
    body?: any;
    headers?: Record<string, string>;
  } = {}
): Promise<{ status: number; data: any }> {
  const fetchOptions: any = {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
  };
  if (options.method) fetchOptions.method = options.method;
  if (options.body !== undefined) fetchOptions.body = typeof options.body === 'string' ? options.body : JSON.stringify(options.body);

  const response = await (globalThis as any).fetch(baseUrl + urlPath, fetchOptions);
  const data = await response.json();
  return { status: response.status, data };
}

// ── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  // Assertions
  assert,
  assertEqual,
  assertIncludes,
  assertGreaterThan,
  getResults,
  resetCounters,

  // Database
  initTestDb,
  seedCountryTaxPackage,
  isNativeAbiMismatch,

  // Express
  createApp,
  startServer,

  // Seed data
  seedOwnerUser,
  seedManagerUser,
  seedCategory,
  seedProduct,
  seedCustomer,
  seedTable,
  seedWalletCredit,

  // API
  api,

  // Re-exports for convenience
  getDatabase,
  closeDatabase,
  now,
};
