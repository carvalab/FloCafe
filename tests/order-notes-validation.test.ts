/**
 * Order Notes Validation Tests
 *
 * Verifies that validateOrderNotes and validateItemNotes enforce
 * character limits loaded from the settings table.
 *
 * Uses node:sqlite (built-in) to avoid better-sqlite3 native module issues.
 * The validation functions are imported from main/routes/orders-validation.ts
 * which has no Electron or heavy dependencies.
 *
 * Usage: ts-node --transpile-only -P tests/tsconfig.json tests/order-notes-validation.test.ts
 */

import { validateOrderNotes, validateItemNotes } from '../main/routes/orders-validation';
import { DatabaseSync } from 'node:sqlite';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';

type TestDb = InstanceType<typeof DatabaseSync>;

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

function assertThrows(fn: () => void, expected: string, message: string) {
  total++;
  try {
    fn();
    failed++;
    console.error(`  ✗ ${message} — expected error but none thrown`);
  } catch (err: any) {
    if (err.message.includes(expected)) {
      passed++;
      console.log(`  ✓ ${message}`);
    } else {
      failed++;
      console.error(`  ✗ ${message} — expected "${expected}" but got "${err.message}"`);
    }
  }
}

function assertDoesNotThrow(fn: () => void, message: string) {
  total++;
  try {
    fn();
    passed++;
    console.log(`  ✓ ${message}`);
  } catch (err: any) {
    failed++;
    console.error(`  ✗ ${message} — unexpected error: ${err.message}`);
  }
}

// Setup: create a test database with settings
const dbPath = path.join(os.tmpdir(), `flo-test-notes-${Date.now()}.db`);
const db: TestDb = new DatabaseSync(dbPath, { open: true });

db.exec(`
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  )
`);

const now = new Date().toISOString();
db.prepare('INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)').run('max_order_notes_length', '200', now);
db.prepare('INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)').run('max_item_notes_length', '100', now);

console.log('Order Notes Validation Tests');
console.log('='.repeat(40));

console.log('\nvalidateOrderNotes:');
assertDoesNotThrow(() => validateOrderNotes(db, null), 'accepts null');
assertDoesNotThrow(() => validateOrderNotes(db, undefined), 'accepts undefined');
assertDoesNotThrow(() => validateOrderNotes(db, ''), 'accepts empty string');
assertDoesNotThrow(() => validateOrderNotes(db, 'a'.repeat(200)), 'accepts 200 characters (boundary)');
assertThrows(() => validateOrderNotes(db, 'a'.repeat(201)), 'exceed maximum length', 'rejects 201 characters (over boundary)');

console.log('\nvalidateItemNotes:');
assertDoesNotThrow(() => validateItemNotes(db, null), 'accepts null');
assertDoesNotThrow(() => validateItemNotes(db, undefined), 'accepts undefined');
assertDoesNotThrow(() => validateItemNotes(db, ''), 'accepts empty string');
assertDoesNotThrow(() => validateItemNotes(db, 'a'.repeat(100)), 'accepts 100 characters (boundary)');
assertThrows(() => validateItemNotes(db, 'a'.repeat(101)), 'exceed maximum length', 'rejects 101 characters (over boundary)');

// Cleanup
db.close();
fs.unlinkSync(dbPath);

console.log('\n' + '='.repeat(40));
console.log(`${passed}/${total} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
