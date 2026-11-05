/**
 * The configured update channel on the daily ping, with the same default as the updater itself: a
 * beta build follows beta until the user stores a choice.
 *
 * Usage: npm run test:telemetry
 */
const Module = require('module');
const originalLoad = Module._load;
const fs = require('fs');
const os = require('os');
const path = require('path');

const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flo-update-channel-'));
process.env.FLO_E2E_DB_PATH = path.join(testDir, 'flo.db');

Module._load = function (request: string, parent: unknown, isMain: boolean) {
  if (request === 'electron') {
    return {
      app: { isPackaged: false, getPath: () => testDir, getVersion: () => '3.14.0-beta.1' },
    };
  }
  return originalLoad.apply(this, arguments as any);
};

const { assertEqualOrThrow } = require('./helpers/test-setup');
const { initTestDb } = require('./helpers/test-setup');
const { upsertSettings } = require('../main/db');
const { readDailyUsageSummary } = require('../main/services/posthog');

function run() {
  console.log('Testing the update channel on the daily ping...');

  initTestDb();
  upsertSettings({ telemetry_enabled: 'true', onboarding_completed: 'true' });

  assertEqualOrThrow(
    readDailyUsageSummary().update_channel,
    'beta',
    'a beta build with no stored choice follows beta, as the updater does',
  );
  upsertSettings({ 'updates.beta_channel_enabled': 'false' });
  assertEqualOrThrow(
    readDailyUsageSummary().update_channel,
    'stable',
    'a stored choice wins over the build default',
  );

  console.log('✅ Update channel checks passed');
}

try {
  run();
} finally {
  Module._load = originalLoad;
  fs.rmSync(testDir, { recursive: true, force: true });
}
