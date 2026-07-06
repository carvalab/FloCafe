/**
 * Loyalty Toggle Tests
 *
 * Verifies that loyalty settings exist in the database after migration.
 *
 * NOTE: The PATCH /api/orders/:id/loyalty endpoint is fully tested in
 * integration-loyalty.test.ts. This file only tests the DB migration
 * seeded the correct default values.
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

// ── Expected loyalty settings ─────────────────────────────────────────────────

const EXPECTED_LOYALTY_SETTINGS: Record<string, string> = {
  loyalty_enabled: 'true',
  loyalty_points_per_currency: '1',
  loyalty_redemption_rate: '100',
  loyalty_max_balance_enabled: '0',
  loyalty_max_balance_points: '10000',
  loyalty_expiry_enabled: '0',
  loyalty_expiry_months: '6',
  loyalty_min_redemption: '100',
  loyalty_max_redemption_percentage: '50',
};

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('Loyalty Toggle Tests');
  console.log('='.repeat(50));

  const db = initTestDb();

  try {
    // ── Test: Loyalty settings exist in database ──────────────────────
    console.log('\n1. Loyalty settings exist in database with correct defaults');
    for (const [key, expectedValue] of Object.entries(EXPECTED_LOYALTY_SETTINGS)) {
      const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as any;
      assert(row !== undefined, `setting "${key}" exists`);
      if (row) {
        assertEqual(row.value, expectedValue, `setting "${key}" = "${expectedValue}"`);
      }
    }

    // ── Test: All loyalty settings present ─────────────────────────────
    console.log('\n2. All loyalty settings present');
    const count = db.prepare("SELECT COUNT(*) as cnt FROM settings WHERE key LIKE 'loyalty_%'").get() as any;
    assert(count?.cnt >= 9, `at least 9 loyalty_* settings (got ${count?.cnt})`);

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
