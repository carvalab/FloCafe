/**
 * The feature-use counts on `daily_ping`: five SQL counts, two in-memory counters, backups, and the
 * restore marker. Every count is a number about use, never a name or an id.
 *
 * Usage: npm run test:telemetry
 */
const Module = require('module');
const originalLoad = Module._load;
const fs = require('fs');
const os = require('os');
const path = require('path');

const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flo-usage-counts-'));
process.env.FLO_E2E_DB_PATH = path.join(testDir, 'flo.db');

Module._load = function (request: string, parent: unknown, isMain: boolean) {
  if (request === 'electron') {
    return { app: { isPackaged: false, getPath: () => testDir, getVersion: () => 'test' } };
  }
  return originalLoad.apply(this, arguments as any);
};

const { EventEmitter } = require('events');
const { assertEqualOrThrow, assertOrThrow } = require('./helpers/test-setup');
const { initTestDb } = require('./helpers/test-setup');
const { upsertSettings, closeDatabase } = require('../main/db');
const { readDailyUsageSummary } = require('../main/services/posthog');
const {
  bumpUsageCounter,
  exportCounterMiddleware,
  readUsageCounters,
} = require('../main/services/usage-counters');
const { getLocalBackupDir, localBackupFileName } = require('../main/services/local-backup');
const { scrubPostHogEvent } = require('../shared/posthog-scrub');

const HOUR_MS = 60 * 60_000;

/** A response double: the middleware listens for `finish` and reads two headers. */
function respond(
  reqPath: string,
  headers: Record<string, string> = {},
  statusCode = 200,
  method = 'GET',
): void {
  const res = new EventEmitter() as any;
  res.statusCode = statusCode;
  res.getHeader = (name: string) => headers[name.toLowerCase()];
  let nexted = false;
  exportCounterMiddleware({ path: reqPath, method } as any, res, () => {
    nexted = true;
  });
  assertOrThrow(nexted, 'the export counter never blocks a request');
  res.emit('finish');
}

function writeBackupFile(writtenAt: Date): void {
  const dir = getLocalBackupDir();
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, localBackupFileName(writtenAt)), '');
}

/** A timestamp in SQLite's own text form, hours behind now. */
function ago(hours = 0): string {
  return new Date(Date.now() - hours * HOUR_MS).toISOString().replace('T', ' ').slice(0, 19);
}

function seedRows(): void {
  const db = initTestDb();
  db.prepare(
    `INSERT INTO users (id, name, email, password, role, is_active, created_at, updated_at)
     VALUES ('u1', 'Owner', 'owner@test.local', 'x', 'owner', 1, ?, ?)`,
  ).run(ago(), ago());

  // Two receipts inside the window, one outside it.
  db.prepare(`INSERT INTO orders (order_number, created_at) VALUES ('o-bill', ?)`).run(ago());
  const orderId = (db.prepare(`SELECT id FROM orders WHERE order_number = 'o-bill'`).get() as any)
    .id;
  db.prepare(`INSERT INTO bills (bill_number, order_id) VALUES ('b1', ?)`).run(orderId);
  const billId = (db.prepare(`SELECT id FROM bills WHERE bill_number = 'b1'`).get() as any).id;
  const receipt = db.prepare(
    `INSERT INTO print_logs (bill_id, user_id, printed_at) VALUES (?, 'u1', ?)`,
  );
  receipt.run(billId, ago());
  receipt.run(billId, ago(1));
  receipt.run(billId, ago(48));

  // Kitchen movement: created and moved inside the window counts, a held order misses out.
  const order = db.prepare(
    `INSERT INTO orders (order_number, created_at, ready_at, served_at) VALUES (?, ?, ?, ?)`,
  );
  order.run('o-ready', ago(), ago(), null);
  order.run('o-served', ago(), null, ago());
  order.run('o-open', ago(), null, null);
  order.run('o-old', ago(48), null, ago());

  const message = db.prepare(
    `INSERT INTO whatsapp_messages (phone_e164, direction, status, body, queued_at)
     VALUES ('+5491100000000', ?, ?, 'hello', ?)`,
  );
  message.run('outbound', 'sent', ago());
  message.run('outbound', 'read', ago(1));
  message.run('outbound', 'failed', ago());
  message.run('inbound', 'sent', ago());
  message.run('outbound', 'sent', ago(48));

  db.prepare(
    `INSERT INTO expense_categories (id, name, name_key, created_by, updated_by, created_at, updated_at)
     VALUES ('cat1', 'Supplies', 'supplies', 'u1', 'u1', ?, ?)`,
  ).run(ago(), ago());
  const expense = db.prepare(
    `INSERT INTO expenses (id, category_id, category_name, description, amount_minor, currency_code, incurred_on, created_by, created_at)
     VALUES (?, 'cat1', 'Supplies', 'milk', 100, 'ARS', date('now'), 'u1', ?)`,
  );
  expense.run('e1', ago());
  expense.run('e2', ago(3));
  expense.run('e3', ago(48));

  db.prepare(`INSERT INTO products (id, name, price) VALUES ('p1', 'Coffee', 100)`).run();
  const movement = db.prepare(
    `INSERT INTO inventory_movements (product_id, quantity_delta, movement_type, actor_user_id, stock_after, created_at)
     VALUES ('p1', -1, ?, 'u1', 10, ?)`,
  );
  movement.run('adjustment', ago());
  movement.run('adjustment', ago(5));
  movement.run('sale', ago());
  movement.run('adjustment', ago(48));
}

function run() {
  console.log('Testing the feature-use counts on the daily ping...');

  seedRows();
  readDailyUsageSummary(); // Drain anything a previous step counted.

  const counts = readDailyUsageSummary();
  assertEqualOrThrow(counts.receipts_printed_24h, 2, 'two receipts in 24h, the older one excluded');
  assertEqualOrThrow(counts.kds_orders_moved_24h, 2, 'two orders moved in 24h');
  assertEqualOrThrow(counts.whatsapp_sent_24h, 2, 'two outbound messages reached a person');
  assertEqualOrThrow(counts.expenses_written_24h, 2, 'two expenses in 24h');
  assertEqualOrThrow(counts.inventory_adjustments_24h, 2, 'a sale is not a stock adjustment');
  assertEqualOrThrow(counts.restores_24h, 0, 'no restore happened');

  upsertSettings({ posthog_restore_at: new Date().toISOString().replace('T', ' ').slice(0, 19) });
  assertEqualOrThrow(readDailyUsageSummary().restores_24h, 1, 'a restore inside 24h is reported');
  upsertSettings({
    posthog_restore_at: new Date(Date.now() - 30 * HOUR_MS)
      .toISOString()
      .replace('T', ' ')
      .slice(0, 19),
  });
  assertEqualOrThrow(readDailyUsageSummary().restores_24h, 0, 'an older restore is not');

  // Only files this service wrote, inside the window, are backups that worked.
  writeBackupFile(new Date());
  writeBackupFile(new Date(Date.now() - 30 * HOUR_MS));
  // A name dated ahead of the clock cannot be trusted, so it is not a backup from the last 24h.
  writeBackupFile(new Date(Date.now() + 2 * HOUR_MS));
  const dir = getLocalBackupDir();
  fs.writeFileSync(path.join(dir, 'notes.txt'), '');
  assertEqualOrThrow(readDailyUsageSummary().backups_ok_24h, 1, 'one backup in 24h');

  // A report download counts; a database backup and a failed response do not.
  const before = readUsageCounters();
  assertEqualOrThrow(before.exports, 0, 'reading the counters returns the delta and resets it');
  const attachment = { 'content-disposition': 'attachment; filename="daily.csv"' };
  respond('/api/reports/daily/export', attachment);
  assertEqualOrThrow(readDailyUsageSummary().exports_24h, 1, 'an attachment response is an export');
  respond('/api/menu-csv/export/products', attachment);
  assertEqualOrThrow(
    readDailyUsageSummary().exports_24h,
    1,
    'a menu CSV download outside /api/db is an export too',
  );
  respond('/api/reports/daily/export', {});
  respond('/api/reports/daily/export', attachment, 500);
  respond('/api/db/backup', attachment, 200, 'POST');
  assertEqualOrThrow(
    readDailyUsageSummary().exports_24h,
    0,
    'no file, a failed response, and a database backup are not exports',
  );

  bumpUsageCounter('server_app_orders');
  assertEqualOrThrow(
    readDailyUsageSummary().server_app_orders_24h,
    1,
    'a Server App order counts until the ping',
  );

  const scrubbed = scrubPostHogEvent(
    {
      event: 'daily_ping',
      properties: {
        receipts_printed_24h: 2,
        kds_orders_moved_24h: 2,
        server_app_orders_24h: 1,
        exports_24h: 1,
        whatsapp_sent_24h: 2,
        backups_ok_24h: 1,
        restores_24h: 0,
        expenses_written_24h: 2,
        inventory_adjustments_24h: 2,
      },
    },
    { telemetryEnabled: true, accountLinked: false, allowExceptions: false },
  );
  for (const key of [
    'receipts_printed_24h',
    'kds_orders_moved_24h',
    'server_app_orders_24h',
    'exports_24h',
    'whatsapp_sent_24h',
    'backups_ok_24h',
    'restores_24h',
    'expenses_written_24h',
    'inventory_adjustments_24h',
  ]) {
    assertOrThrow(
      typeof scrubbed.properties[key] === 'number',
      `${key} survives the allowlist as a number`,
    );
  }

  console.log('✅ Feature-use count checks passed');
}

try {
  run();
} finally {
  Module._load = originalLoad;
  closeDatabase();
  fs.rmSync(testDir, { recursive: true, force: true });
}
