import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const Module = require('module');
const originalLoad = Module._load;
const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flo-security-'));

Module._load = function (request: string, parent: unknown, isMain: boolean) {
  if (request === 'electron') {
    return {
      app: {
        isPackaged: true,
        getPath: () => testDir,
        getVersion: () => 'test',
      },
    };
  }
  return originalLoad.apply(this, arguments as any);
};

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const request = require('supertest');
const {
  initTestDb,
  createApp,
  assertEqual,
  assert,
  getResults,
  closeDatabase,
  now,
} = require('./helpers/test-setup');

const { staffRoutes } = require('../main/routes/staff');
const { kdsRoutes } = require('../main/routes/kds');
const { kitchenRoutes } = require('../main/routes/kitchen');
const { databaseRoutes } = require('../main/routes/database');
const { getJWTSecret } = require('../main/routes/auth');

function seedUser(db: any, id: string, role: string, email: string, categoryIds?: string[]) {
  db.prepare(`
    INSERT OR REPLACE INTO users (id, name, email, password, role, pin_hash, category_ids, is_active, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
  `).run(
    id,
    `${role} user`,
    email,
    bcrypt.hashSync('testpass123', 10),
    role,
    bcrypt.hashSync('1234', 10),
    categoryIds ? JSON.stringify(categoryIds) : null,
    now(),
    now(),
  );

  const token = jwt.sign({ userId: id, email, role }, getJWTSecret(), { expiresIn: '1h' });
  return { Authorization: `Bearer ${token}` };
}

async function main() {
  console.log('Security Hardening Regression Tests');
  console.log('='.repeat(60));

  const db = initTestDb();
  const ownerAuth   = seedUser(db, 'security-owner',   'owner',   'security-owner@test.local');
  const managerAuth = seedUser(db, 'security-manager', 'manager', 'security-manager@test.local');
  const cashierAuth = seedUser(db, 'security-cashier', 'cashier', 'security-cashier@test.local');
  const waiterAuth  = seedUser(db, 'security-waiter',  'waiter',  'security-waiter@test.local');
  const chefAuth    = seedUser(db, 'security-chef',    'chef',    'security-chef@test.local', ['cat-security']);

  db.prepare(`
    INSERT OR IGNORE INTO categories (id, name, is_active, created_at, updated_at)
    VALUES ('cat-security', 'Security Category', 1, ?, ?)
  `).run(now(), now());

  const app = createApp({
    '/api/staff':   staffRoutes,
    '/api/kds':     kdsRoutes,
    '/api/kitchen': kitchenRoutes,
    '/api/db':      databaseRoutes,
  });

  const cashierStaff = await request(app).get('/api/staff').set(cashierAuth);
  assertEqual(cashierStaff.status, 403, 'cashier cannot list staff');

  const managerStaff = await request(app).get('/api/staff').set(managerAuth);
  assertEqual(managerStaff.status, 200, 'manager can list staff');
  assert(!('pin_hash' in managerStaff.body.staff[0]), 'staff list does not expose pin_hash');

  const cashierKds = await request(app).get('/api/kds/pairing').set(cashierAuth);
  assertEqual(cashierKds.status, 403, 'cashier cannot access KDS routes');

  const chefKds = await request(app).get('/api/kds/pairing').set(chefAuth);
  assertEqual(chefKds.status, 200, 'chef can access KDS read routes');

  const chefPairingPost = await request(app).post('/api/kds/pairing').set(chefAuth).send({});
  assertEqual(chefPairingPost.status, 403, 'chef cannot create KDS pairing tokens');

  const managerPairingPost = await request(app).post('/api/kds/pairing').set(managerAuth).send({});
  assertEqual(managerPairingPost.status, 201, 'manager can create KDS pairing tokens');

  // POST, not GET: a GET can't safely carry the Master PIN in a request body.
  const managerBackup = await request(app).post('/api/db/backup').set(managerAuth).send({});
  assertEqual(managerBackup.status, 403, 'manager cannot create database backup through API');

  const ownerTables = await request(app).get('/api/db/tables').set(ownerAuth);
  assertEqual(ownerTables.status, 200, 'owner can inspect database table metadata');

  // ── vuln-0004: /api/kitchen/orders role enforcement ───────────────────────
  const cashierKitchen = await request(app).get('/api/kitchen/orders').set(cashierAuth);
  assertEqual(cashierKitchen.status, 403, 'cashier cannot access kitchen orders (vuln-0004)');

  const waiterKitchen = await request(app).get('/api/kitchen/orders').set(waiterAuth);
  assertEqual(waiterKitchen.status, 403, 'waiter cannot access kitchen orders (vuln-0004)');

  const chefKitchen = await request(app).get('/api/kitchen/orders').set(chefAuth);
  assertEqual(chefKitchen.status, 200, 'chef can access kitchen orders');

  const managerKitchen = await request(app).get('/api/kitchen/orders').set(managerAuth);
  assertEqual(managerKitchen.status, 200, 'manager can access kitchen orders');

  const ownerKitchen = await request(app).get('/api/kitchen/orders').set(ownerAuth);
  assertEqual(ownerKitchen.status, 200, 'owner can access kitchen orders');

  const results = getResults();
  if (results.failed > 0) {
    throw new Error(`${results.failed} security hardening assertion(s) failed`);
  }
}

main()
  .then(() => {
    closeDatabase();
    Module._load = originalLoad;
    fs.rmSync(testDir, { recursive: true, force: true });
    console.log('\nSecurity hardening tests passed');
  })
  .catch((error) => {
    try { closeDatabase(); } catch { }
    Module._load = originalLoad;
    fs.rmSync(testDir, { recursive: true, force: true });
    console.error(error);
    process.exit(1);
  });
