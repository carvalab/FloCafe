/**
 * Print Logs Table Tests
 *
 * Verifies that the print_logs table exists and supports basic
 * insert/query operations for tracking receipt printing actions.
 *
 * Usage: ts-node --transpile-only -P tests/tsconfig.json tests/print-logs.test.ts
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

// Mock electron before importing db module
const Module = require('module');
const originalLoad = Module._load;
const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flo-print-logs-'));

const mockApp = {
  isPackaged: true,
  getPath: (_name: string) => testDir,
  getVersion: () => 'test',
};

Module._load = function (request: string, parent: unknown, isMain: boolean) {
  if (request === 'electron') return { app: mockApp };
  return originalLoad.apply(this, arguments as any);
};

const { initDatabase, getDatabase, closeDatabase } = require('../main/db');

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

try {
  initDatabase();
} catch (error: any) {
  console.error('Failed to initialize database:', error.message);
  process.exit(1);
}

console.log('Print Logs Table Tests');
console.log('='.repeat(50));

console.log('\nTable existence:');
const db = getDatabase();

const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='print_logs'").all();
assert(tables.length === 1, 'print_logs table exists');

// Create prerequisite rows for foreign keys
db.exec("INSERT OR IGNORE INTO users (id, name, password, role) VALUES ('user-1', 'Test User', 'hash', 'cashier')");
db.exec("INSERT OR IGNORE INTO orders (order_number, user_id) VALUES ('ORD-TEST-0001', 'user-1')");
db.exec("INSERT OR IGNORE INTO bills (bill_number, order_id) VALUES ('INV-TEST-0001', 1)");

console.log('\nInsert operations:');
let insertRowId: number | undefined;
try {
  const result = db.prepare(
    'INSERT INTO print_logs (bill_id, user_id, print_type) VALUES (?, ?, ?)'
  ).run(1, 'user-1', 'receipt');
  insertRowId = result.lastInsertRowid as number;
  assert(insertRowId !== undefined && insertRowId !== null, 'insert returns lastInsertRowid');
} catch (err: any) {
  assert(false, `insert failed: ${err.message}`);
}

console.log('\nQuery operations:');
if (insertRowId !== undefined) {
  const row = db.prepare('SELECT * FROM print_logs WHERE id = ?').get(insertRowId) as any;
  assert(row !== undefined, 'can retrieve inserted row');
  assert(row.bill_id === 1, 'bill_id stored correctly');
  assert(row.user_id === 'user-1', 'user_id stored correctly');
  assert(row.print_type === 'receipt', 'print_type stored correctly');
  assert(row.printed_at !== null, 'printed_at defaults to current timestamp');
} else {
  assert(false, 'skipped: no row to query');
  assert(false, 'skipped: no row to query');
  assert(false, 'skipped: no row to query');
  assert(false, 'skipped: no row to query');
  assert(false, 'skipped: no row to query');
}

console.log('\n' + '='.repeat(50));
console.log(`${passed}/${total} passed, ${failed} failed`);

closeDatabase();
Module._load = originalLoad;
fs.rmSync(testDir, { recursive: true, force: true });

process.exit(failed === 0 ? 0 : 1);
