/**
 * Receipt Printing Tests
 *
 * Verifies the unified printReceipt function logs print actions to the
 * print_logs table correctly for both receipt and reprint types.
 *
 * Usage: ts-node --transpile-only -P tests/tsconfig.json tests/receipt-printing.test.ts
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

// Mock electron before importing db module
const Module = require('module');
const originalLoad = Module._load;
const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flo-receipt-printing-'));

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
const { printReceipt } = require('../main/services/receipt');

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

console.log('Receipt Printing Tests');
console.log('='.repeat(50));

const db = getDatabase();

// Create prerequisite rows for foreign keys
db.exec("INSERT OR IGNORE INTO users (id, name, password, role) VALUES ('user-1', 'Test User', 'hash', 'cashier')");
db.exec("INSERT OR IGNORE INTO orders (order_number, user_id) VALUES ('ORD-TEST-RECEIPT-0001', 'user-1')");
db.exec("INSERT OR IGNORE INTO bills (bill_number, order_id) VALUES ('INV-TEST-RECEIPT-0001', (SELECT id FROM orders WHERE order_number = 'ORD-TEST-RECEIPT-0001'))");

const testBillId = db.prepare("SELECT id FROM bills WHERE bill_number = 'INV-TEST-RECEIPT-0001'").get() as { id: number } | undefined;

async function runTests() {
  console.log('\nTest 1: printReceipt logs print action');
  {
    if (!testBillId) {
      assert(false, 'skipped: no test bill found');
    } else {
      const initialCount = (db.prepare('SELECT COUNT(*) as count FROM print_logs').get() as { count: number }).count;

      try {
        const result = await printReceipt(testBillId.id, 'user-1', 'receipt');
        assert(result.success === true, 'printReceipt returns success: true');
        assert(result.printLogId !== undefined, 'printReceipt returns printLogId');

        const finalCount = (db.prepare('SELECT COUNT(*) as count FROM print_logs').get() as { count: number }).count;
        assert(finalCount === initialCount + 1, 'print_logs count increased by 1');
      } catch (err: any) {
        assert(false, `printReceipt threw: ${err.message}`);
      }
    }
  }

  console.log('\nTest 2: printReceipt logs reprint action');
  {
    if (!testBillId) {
      assert(false, 'skipped: no test bill found');
    } else {
      try {
        await printReceipt(testBillId.id, 'user-1', 'reprint');

        const log = db.prepare('SELECT print_type FROM print_logs ORDER BY id DESC LIMIT 1').get() as { print_type: string } | undefined;
        assert(log !== undefined, 'print_log row exists after reprint');
        assert(log!.print_type === 'reprint', 'print_type is "reprint"');
      } catch (err: any) {
        assert(false, `printReceipt (reprint) threw: ${err.message}`);
      }
    }
  }

  console.log('\nTest 3: printReceipt throws for non-existent bill');
  {
    try {
      await printReceipt(999999, 'user-1', 'receipt');
      assert(false, 'expected error for non-existent bill');
    } catch (err: any) {
      assert(err.message.includes('Bill not found'), `throws "Bill not found": ${err.message}`);
    }
  }

  console.log('\nTest 4: printReceipt updates bill printed_at');
  {
    if (!testBillId) {
      assert(false, 'skipped: no test bill found');
    } else {
      try {
        // Reset printed_at to verify it gets set by printReceipt
        db.prepare('UPDATE bills SET printed_at = NULL WHERE id = ?').run(testBillId.id);
        const before = db.prepare('SELECT printed_at FROM bills WHERE id = ?').get(testBillId.id) as { printed_at: string | null } | undefined;
        assert(before?.printed_at === null || before?.printed_at === undefined, 'printed_at is null before first print');

        await printReceipt(testBillId.id, 'user-1', 'receipt');

        const after = db.prepare('SELECT printed_at FROM bills WHERE id = ?').get(testBillId.id) as { printed_at: string | null } | undefined;
        assert(after?.printed_at !== null && after?.printed_at !== undefined, 'printed_at is set after print');
      } catch (err: any) {
        assert(false, `printReceipt threw: ${err.message}`);
      }
    }
  }

  console.log('\n' + '='.repeat(50));
  console.log(`${passed}/${total} passed, ${failed} failed`);

  closeDatabase();
  Module._load = originalLoad;
  fs.rmSync(testDir, { recursive: true, force: true });

  process.exit(failed === 0 ? 0 : 1);
}

runTests();
