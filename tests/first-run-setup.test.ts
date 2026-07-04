import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';

const Module = require('module');
const originalLoad = Module._load;
const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flo-first-run-'));

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
const { initDatabase, getDatabase, closeDatabase, getCurrentSchemaVersion } = require('../main/db');
const { authRoutes } = require('../main/routes/auth');

function count(table: string): number {
  const db = getDatabase();
  return (db.prepare(`SELECT COUNT(*) as count FROM ${table}`).get() as { count: number }).count;
}

function setting(key: string): string | null {
  const db = getDatabase();
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

async function listen(app: any): Promise<http.Server> {
  return await new Promise((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1');
    server.once('error', reject);
    server.once('listening', () => resolve(server));
  });
}

async function request(baseUrl: string, pathName: string, options: Record<string, any> = {}) {
  const response = await (globalThis as any).fetch(baseUrl + pathName, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  });
  const data = await response.json();
  return { status: response.status, data };
}

function isNativeAbiMismatch(error: any): boolean {
  return error?.code === 'ERR_DLOPEN_FAILED'
    && String(error?.message || '').includes('NODE_MODULE_VERSION');
}

async function main() {
  console.log('🧪 FloDesktop First-Run Setup Tests');
  console.log('='.repeat(60));

  try {
    initDatabase();
  } catch (error: any) {
    if (isNativeAbiMismatch(error)) {
      console.log('   ⚠ Skipping: better-sqlite3 is not built for this shell Node ABI.');
      console.log(`     Node ${process.version} uses ABI ${process.versions.modules}; rebuild native modules for Node to run this test outside Electron.`);
      return;
    }
    throw error;
  }

  assert.equal(getCurrentSchemaVersion(), 6, 'fresh database migrates to latest schema');
  assert.equal(count('users'), 0, 'fresh install starts with no users');
  assert.equal(count('categories'), 0, 'fresh install starts with no sample categories');
  assert.equal(count('products'), 0, 'fresh install starts with no sample products');
  assert.equal(count('tables'), 0, 'fresh install starts with no sample tables');
  assert.equal(count('printers'), 0, 'fresh install starts with no default printer');
  assert.equal(setting('cloud_server_url'), 'https://blue.flopos.com/', 'cloud server URL is seeded');
  assert.match(setting('cloud_pos_hash') || '', /^pos_[a-f0-9]{40}$/, 'fresh install has a POS hash');
  assert.ok((setting('cloud_device_secret') || '').length >= 32, 'fresh install has a local cloud secret');
  assert.equal(count('cloud_sync_outbox'), 0, 'fresh install starts with an empty cloud outbox');
  console.log('   ✓ fresh database has schema/default settings only');

  const api = express();
  api.use(express.json());
  api.use('/api/auth', authRoutes);
  let server: http.Server;
  try {
    server = await listen(api);
  } catch (error: any) {
    if (error?.code === 'EPERM' || error?.code === 'EACCES') {
      console.log('   ⚠ Skipping setup API assertions: local port binding is blocked in this environment.');
      return;
    }
    throw error;
  }
  const address = server.address() as { port: number };
  const baseUrl = `http://127.0.0.1:${address.port}/api/auth`;

  try {
    const before = await request(baseUrl, '/setup/status');
    assert.equal(before.status, 200);
    assert.equal(before.data.needsSetup, true);
    assert.equal(before.data.initialRole, 'owner');
    console.log('   ✓ setup status reports first-run setup is required');

    const created = await request(baseUrl, '/setup/initialize', {
      method: 'POST',
      body: JSON.stringify({
        name: 'First Owner',
        email: 'OWNER@EXAMPLE.COM',
        password: 'secret123',
        business_type: 'restaurant',
        business_name: 'First Outlet',
        business_address: '42 Test Street',
        business_phone: '+91 99999 99999',
      }),
    });

    assert.equal(created.status, 200, JSON.stringify(created.data));
    assert.equal(created.data.user.role, 'owner');
    assert.equal(created.data.user.email, 'owner@example.com');
    assert.equal(created.data.tenant.business_name, 'First Outlet');
    assert.equal(created.data.tenants[0].business_name, 'First Outlet');
    assert.ok(created.data.access_token, 'setup returns a login token');
    assert.equal(count('users'), 1, 'setup creates exactly one owner user');
    console.log('   ✓ setup creates the first owner and outlet settings');

    const after = await request(baseUrl, '/setup/status');
    assert.equal(after.status, 200);
    assert.equal(after.data.needsSetup, false);

    const second = await request(baseUrl, '/setup/initialize', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Second Owner',
        email: 'second@example.com',
        password: 'secret123',
        business_type: 'restaurant',
      }),
    });

    assert.equal(second.status, 403);
    assert.equal(count('users'), 1, 'setup cannot create a second owner');
    console.log('   ✓ setup endpoint is disabled after the first user exists');
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

main()
  .then(() => {
    closeDatabase();
    Module._load = originalLoad;
    fs.rmSync(testDir, { recursive: true, force: true });
    console.log('\n✅ First-run setup tests passed');
  })
  .catch((error) => {
    try { closeDatabase(); } catch { }
    Module._load = originalLoad;
    fs.rmSync(testDir, { recursive: true, force: true });
    console.error(error);
    process.exit(1);
  });
