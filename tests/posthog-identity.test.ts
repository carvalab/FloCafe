/**
 * Identity: the ping says which level a store shares at, and a diagnostics-only install keeps one
 * crash id instead of a new one every launch.
 *
 * Usage: npm run test:telemetry
 */
const Module = require('module');
const originalLoad = Module._load;
const fs = require('fs');
const os = require('os');
const path = require('path');

const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flo-identity-'));
process.env.FLO_E2E_DB_PATH = path.join(testDir, 'flo.db');

Module._load = function (request: string, parent: unknown, isMain: boolean) {
  if (request === 'electron') {
    return { app: { isPackaged: false, getPath: () => testDir, getVersion: () => 'test' } };
  }
  return originalLoad.apply(this, arguments as any);
};

const { assertEqualOrThrow, assertOrThrow } = require('./helpers/test-setup');
const { initTestDb } = require('./helpers/test-setup');
const { getDatabase, upsertSettings, closeDatabase } = require('../main/db');

function settingsRow(key: string): string {
  const row = getDatabase().prepare('SELECT value FROM settings WHERE key = ?').get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? '';
}
const { readDailyUsageSummary } = require('../main/services/posthog');
const { createHash } = require('crypto');
const { readInstallRef, resolvePostHogIdentity } = require('../main/services/posthog-identity');
const { scrubPostHogEvent } = require('../shared/posthog-scrub');

function run() {
  console.log('Testing the sharing level and the diagnostics-only id...');

  initTestDb();
  upsertSettings({ telemetry_enabled: 'true', onboarding_completed: 'true' });

  // An onboarded store that has not answered the one-time question shares anonymously.
  assertEqualOrThrow(
    readDailyUsageSummary().analytics_level,
    'anonymous',
    'no stored choice is reported as anonymous',
  );
  upsertSettings({ product_analytics_level: 'full' });
  assertEqualOrThrow(
    readDailyUsageSummary().analytics_level,
    'full',
    'a stored choice is reported as full',
  );
  const scrubbed = scrubPostHogEvent(
    { event: 'daily_ping', properties: readDailyUsageSummary() },
    { telemetryEnabled: true, accountLinked: true, allowExceptions: false },
  );
  assertEqualOrThrow(scrubbed.properties.analytics_level, 'full', 'the level survives the scrub');

  // At the `off` level with diagnostics on, the crash id is stable per install and not the
  // usage device id, so the two cannot be joined.
  const first = resolvePostHogIdentity('off');
  const second = resolvePostHogIdentity('off');
  assertEqualOrThrow(first.distinctId, second.distinctId, 'a second launch keeps the same id');
  assertOrThrow(
    /^anon_[0-9a-f]{16}$/.test(first.distinctId),
    'the id is the documented shape, not a per-launch UUID',
  );
  // Pinned to the exact derivation, so a random id per call or a reuse of the device id fails.
  const seed = settingsRow('posthog_install_seed');
  const expected = `anon_${createHash('sha256').update(`${seed}:diagnostics`).digest('hex').slice(0, 16)}`;
  assertEqualOrThrow(first.distinctId, expected, 'the crash id is derived from the install seed');
  assertOrThrow(
    first.distinctId !== `anon_${readInstallRef()}`,
    'the crash id is not the usage device id',
  );

  const alias = scrubPostHogEvent(
    {
      event: '$create_alias',
      properties: { distinct_id: 'acct_0123456789abcdef', alias: 'inst_0123456789abcdef' },
    },
    { telemetryEnabled: true, accountLinked: true, allowExceptions: false },
  );
  assertEqualOrThrow(
    alias?.properties?.alias,
    'inst_0123456789abcdef',
    'the device-to-account alias still passes',
  );
  assertEqualOrThrow(
    scrubPostHogEvent(
      {
        event: '$create_alias',
        properties: { distinct_id: 'acct_0123456789abcdef', alias: 'ada' },
      },
      { telemetryEnabled: true, accountLinked: true, allowExceptions: false },
    ),
    null,
    'any other id shape is still refused',
  );

  console.log('✅ Identity checks passed');
}

try {
  run();
} finally {
  Module._load = originalLoad;
  closeDatabase();
  fs.rmSync(testDir, { recursive: true, force: true });
}
