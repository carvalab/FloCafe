/**
 * Loyalty Toggle Tests
 *
 * Verifies that the loyalty program is a single on/off setting after migration —
 * the old tuning settings (earning rate, redemption rate, expiry, balance cap, etc.)
 * are cleaned up and no longer present.
 *
 * Usage: node tests/run-electron-node-test.cjs tests/loyalty-toggle.test.ts
 */

// ── Electron Mock (must be before any app imports) ───────────────────────────
const Module = require('module');
const originalLoad = Module._load;
const fs = require('fs');
const os = require('os');
const path = require('path');
const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flo-loyalty-toggle-'));
Module._load = function (request: string, parent: unknown, isMain: boolean) {
  if (request === 'electron') return { app: { isPackaged: true, getPath: () => testDir, getVersion: () => 'test' } };
  return originalLoad.apply(this, arguments as any);
};

const {
  initTestDb, getResults, closeDatabase,
  assert, assertEqual,
} = require('./helpers/test-setup');

const REMOVED_LOYALTY_SETTINGS = [
  'loyalty_points_per_currency',
  'loyalty_redemption_rate',
  'loyalty_max_balance_enabled',
  'loyalty_max_balance_points',
  'loyalty_expiry_enabled',
  'loyalty_expiry_months',
  'loyalty_min_redemption',
  'loyalty_max_redemption_percentage',
  'loyalty_expiry_days',
];

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('Loyalty Toggle Tests');
  console.log('='.repeat(50));

  const db = initTestDb();

  try {
    // ── Test: loyalty_enabled exists with default ──────────────────────
    console.log('\n1. loyalty_enabled setting exists');
    const row = db.prepare("SELECT value FROM settings WHERE key = 'loyalty_enabled'").get() as any;
    assert(row !== undefined, 'setting "loyalty_enabled" exists');
    if (row) assertEqual(row.value, 'true', 'setting "loyalty_enabled" = "true"');

    // ── Test: retired tuning settings are gone ─────────────────────────
    console.log('\n2. Retired loyalty tuning settings are removed');
    for (const key of REMOVED_LOYALTY_SETTINGS) {
      const removed = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
      assert(removed === undefined, `setting "${key}" no longer present`);
    }

    // ── Test: customers.loyalty_points column dropped ──────────────────
    console.log('\n3. customers.loyalty_points column removed');
    const cols = db.prepare('PRAGMA table_info(customers)').all() as { name: string }[];
    assert(!cols.some((c) => c.name === 'loyalty_points'), 'customers.loyalty_points column dropped');

    // ── Summary ───────────────────────────────────────────────────────
    console.log('\n' + '='.repeat(50));
    const results = getResults();
    console.log(`Results: ${results.passed}/${results.total} passed, ${results.failed} failed`);
    process.exit(results.failed > 0 ? 1 : 0);
  } catch (error: any) {
    console.error(`\n✗ Test crashed: ${error.message}`);
    console.error(error.stack);
    process.exit(1);
  } finally {
    closeDatabase();
  }
}

main();
