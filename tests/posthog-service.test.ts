import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const Module = require('module');
const originalLoad = Module._load;
const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flo-posthog-service-'));
process.env.FLO_E2E_DB_PATH = path.join(testDir, 'flo.db');

interface CapturedEvent {
  distinctId?: string;
  event?: string;
  properties?: Record<string, unknown>;
}

interface RecordedClient {
  token: string;
  options: {
    host?: string;
  };
  events: CapturedEvent[];
  shutdowns: number;
}

const clients: RecordedClient[] = [];

Module._load = function (request: string, parent: unknown, isMain: boolean) {
  if (request === 'electron') {
    return {
      app: {
        isPackaged: false, // Unpackaged development environment
        getPath: () => testDir,
        getVersion: () => '2.7.2-dev',
      },
    };
  }
  if (request === 'posthog-node') {
    return {
      PostHog: class {
        token: string;
        options: RecordedClient['options'];
        events: CapturedEvent[] = [];
        shutdowns = 0;
        constructor(token: string, options: RecordedClient['options']) {
          this.token = token;
          this.options = options;
          clients.push(this);
        }
        capture(payload: CapturedEvent) {
          this.events.push(payload);
        }
        captureException() {}
        alias() {}
        async shutdown() {
          this.shutdowns += 1;
        }
      },
    };
  }
  return originalLoad.apply(this, arguments as any);
};

Object.defineProperty(process, 'type', { value: 'browser', configurable: true });

const { initDatabase, getDatabase, closeDatabase, now } = require('../main/db');
const { telemetry, sendEvent, TELEMETRY_URL } = require('../main/services/telemetry');

function setSetting(key: string, value: string) {
  getDatabase()
    .prepare(
      `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    )
    .run(key, value, now());
}

function allCapturedEvents(): CapturedEvent[] {
  return clients.flatMap((c) => c.events);
}

function clearCapturedEvents(): void {
  for (const c of clients) {
    c.events.length = 0;
  }
}

async function main() {
  initDatabase();

  const originalFetch = globalThis.fetch;
  const originalSetInterval = globalThis.setInterval;
  let capturedIntervalCallback: (() => void) | null = null;
  globalThis.setInterval = ((handler: TimerHandler, timeout?: number, ...args: any[]) => {
    if (typeof handler === 'function') {
      capturedIntervalCallback = handler as () => void;
    }
    return originalSetInterval(handler, timeout, ...args);
  }) as typeof setInterval;

  const collectorRequests: Array<{ url: string; body: unknown }> = [];
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    collectorRequests.push({
      url: String(url),
      body: init?.body ? JSON.parse(String(init.body)) : null,
    });
    return new Response(null, { status: 204 });
  }) as typeof fetch;

  try {
    // Verify FLO_POSTHOG_DEV=1 forwards usage events and checks without collector traffic.
    console.log('Testing PostHog dev opt-in behavior...');

    process.env.NODE_ENV = 'development';
    process.env.FLO_POSTHOG_DEV = '1';
    process.env.FLO_POSTHOG_DEV_TOKEN = 'phc_dev_test';
    delete process.env.FLO_TELEMETRY_DEV;
    delete process.env.FLO_MATRIX_OFFLINE;
    delete process.env.FLO_OFFLINE_MATRIX;
    delete process.env.CI;
    delete process.env.E2E_TASK_LOCAL_PORTS;
    delete process.env.FLO_E2E_SKIP_OPTIONAL_NETWORK;

    setSetting('telemetry_enabled', 'true');
    setSetting('product_analytics_level', 'anonymous');

    collectorRequests.length = 0;
    clearCapturedEvents();

    const orderCreatedResult = await sendEvent('order_created', { order_type: 'dine_in' });
    assert.equal(orderCreatedResult, false, 'sendEvent returns false when collector is suppressed');

    await sendEvent('feature_used', { feature: 'split_checks', action: 'enabled' });

    telemetry.start();

    const events = allCapturedEvents();

    assert.equal(
      collectorRequests.length,
      0,
      'FloAdmin collector must receive 0 requests when FLO_TELEMETRY_DEV is unset in dev',
    );

    assert.ok(
      events.length > 0,
      'PostHog received 0 events because telemetry was suppressed in unpackaged dev with FLO_POSTHOG_DEV=1',
    );
    assert.ok(
      events.some((e) => e.event === 'feature_used'),
      'PostHog should receive mirrored feature_used event',
    );
    assert.ok(
      events.some((e) => e.event === 'app_launch'),
      'PostHog should receive app_launch event from telemetry.start()',
    );
    assert.ok(
      events.some((e) => e.event === 'daily_ping'),
      'PostHog should receive daily_ping event from runPostHogDailyChecks()',
    );

    // Test the hourly PostHog interval callback
    clearCapturedEvents();
    collectorRequests.length = 0;
    setSetting('posthog_last_daily_ping', '2020-01-01 00:00:00');
    setSetting('posthog_last_daily_ping_at', '2020-01-01 00:00:00');
    assert.ok(capturedIntervalCallback, 'Hourly interval callback should be registered');
    capturedIntervalCallback!();

    assert.ok(
      allCapturedEvents().some((e) => e.event === 'daily_ping'),
      'Hourly interval callback should send daily_ping to PostHog',
    );
    assert.equal(
      collectorRequests.length,
      0,
      'FloAdmin collector must receive 0 requests from hourly interval execution',
    );

    // The daily ping reports the update state the updater last reached.
    const { maybeSendPostHogDailyPing } = require('../main/services/posthog');
    const { recordUpdateStatusForMeasurement } = require('../main/update-state');
    const { scrubPostHogEvent } = require('../shared/posthog-scrub');

    function lastDailyPing(): Record<string, any> {
      const pings = allCapturedEvents().filter((e) => e.event === 'daily_ping');
      assert.equal(pings.length, 1, 'exactly one daily ping per window');
      return (pings[0].properties ?? {}) as Record<string, any>;
    }

    clearCapturedEvents();
    setSetting('posthog_last_daily_ping_at', '2020-01-01 00:00:00');
    recordUpdateStatusForMeasurement({ status: 'check-failed', reason: 'download-failed' });
    maybeSendPostHogDailyPing();
    const failedUpdate = lastDailyPing();
    assert.equal(failedUpdate.update_status, 'check-failed', 'the update state is reported');
    assert.equal(failedUpdate.update_available, false, 'a failed check offers no update');
    assert.equal(failedUpdate.update_channel, 'stable', 'the configured channel is reported');
    assert.equal(
      failedUpdate.update_reason,
      'download-failed',
      'the reason is reported when known',
    );

    clearCapturedEvents();
    setSetting('posthog_last_daily_ping_at', '2020-01-01 00:00:00');
    recordUpdateStatusForMeasurement({ status: 'available', version: '9.9.9' });
    maybeSendPostHogDailyPing();
    const availableUpdate = lastDailyPing();
    assert.equal(availableUpdate.update_status, 'available');
    assert.equal(availableUpdate.update_available, true, 'an available update is reported');
    assert.equal(
      'update_reason' in availableUpdate,
      false,
      'no reason key unless the check or download failed',
    );

    // The allowlist keeps the four update properties on their own, with their plain values.
    const scrubbedUpdate = scrubPostHogEvent(
      {
        event: 'daily_ping',
        properties: {
          update_status: 'ready-to-install',
          update_available: true,
          update_channel: 'beta',
          update_reason: 'manifest-missing',
        },
      },
      { telemetryEnabled: true, accountLinked: false, allowExceptions: false },
    );
    assert.deepEqual(
      {
        update_status: scrubbedUpdate.properties.update_status,
        update_available: scrubbedUpdate.properties.update_available,
        update_channel: scrubbedUpdate.properties.update_channel,
        update_reason: scrubbedUpdate.properties.update_reason,
      },
      {
        update_status: 'ready-to-install',
        update_available: true,
        update_channel: 'beta',
        update_reason: 'manifest-missing',
      },
      'the update enums survive the scrubber unchanged',
    );

    // Three database-derived milestones, sent once each, and their setup profile.
    const { checkPostHogMilestones } = require('../main/services/posthog');
    const db = getDatabase();
    const ago = (hours: number) =>
      new Date(Date.now() - hours * 60 * 60_000).toISOString().replace('T', ' ').slice(0, 19);

    // An install that has been pinging for two days: milestones newer than that are live ones.
    setSetting('setup_profile', 'express');
    setSetting('posthog_milestones_since', ago(48));
    db.prepare(
      `INSERT INTO users (id, name, email, password, role, is_active, created_at, updated_at)
       VALUES ('u-mile', 'Owner', 'owner@example.com', 'x', 'owner', 1, ?, ?)`,
    ).run(ago(10), ago(10));
    db.prepare(
      `INSERT INTO products (id, name, price, created_at) VALUES ('p-mile', 'Coffee', 100, ?)`,
    ).run(ago(5));

    clearCapturedEvents();
    checkPostHogMilestones();
    const products = allCapturedEvents().filter((e) => e.event === 'first_product_created');
    assert.equal(products.length, 1, 'the first product is one milestone');
    assert.equal(products[0].properties?.hours_since_setup, 5, 'it reports when it happened');
    assert.equal(products[0].properties?.setup_profile, 'express', 'the setup profile rides along');
    assert.equal('backfilled' in (products[0].properties ?? {}), false, 'a live milestone is not');

    clearCapturedEvents();
    checkPostHogMilestones();
    assert.equal(
      allCapturedEvents().filter((e) => e.event === 'first_product_created').length,
      0,
      'a milestone is sent once per install',
    );

    // A receipt printed after the first check is a live milestone, not a backfilled one.
    db.prepare(`INSERT INTO orders (order_number, created_at) VALUES ('o-mile', ?)`).run(ago(1));
    const orderId = (db.prepare(`SELECT id FROM orders WHERE order_number = 'o-mile'`).get() as any)
      .id;
    db.prepare(`INSERT INTO bills (bill_number, order_id) VALUES ('b-mile', ?)`).run(orderId);
    const billId = (db.prepare(`SELECT id FROM bills WHERE bill_number = 'b-mile'`).get() as any)
      .id;
    db.prepare(`INSERT INTO print_logs (bill_id, user_id, printed_at) VALUES (?, 'u-mile', ?)`).run(
      billId,
      ago(72),
    );
    clearCapturedEvents();
    checkPostHogMilestones();
    const receipts = allCapturedEvents().filter((e) => e.event === 'first_receipt_printed');
    assert.equal(receipts.length, 1, 'the first receipt is one milestone');
    assert.equal(
      receipts[0].properties?.backfilled,
      true,
      'a receipt from before the first check on this install is backfilled',
    );

    // A per-staff session closure is not the day close.
    const closure = db.prepare(
      `INSERT INTO cash_closures (scope, business_date, period_start, period_end, expected_cash_cents,
         counted_cash_cents, variance_cents, gross_collected_cents, refunded_cents, net_collected_cents,
         bill_count, refund_count, z_number, closed_by, created_at)
       VALUES (?, ?, ?, ?, 0, 0, 0, 0, 0, 0, 0, 0, ?, 'u-mile', ?)`,
    );
    closure.run('session', '2026-01-01', ago(20), ago(20), 9001, ago(20));
    clearCapturedEvents();
    checkPostHogMilestones();
    assert.equal(
      allCapturedEvents().filter((e) => e.event === 'first_day_closed').length,
      0,
      'a session closure is not a day close',
    );
    closure.run('day', '2026-01-02', ago(1), ago(1), 9002, ago(1));
    clearCapturedEvents();
    checkPostHogMilestones();
    assert.equal(
      allCapturedEvents().filter((e) => e.event === 'first_day_closed').length,
      1,
      'the first day close is a milestone',
    );

    // The allowlist keeps the three events and the setup profile, and drops anything else.
    for (const event of ['first_product_created', 'first_receipt_printed', 'first_day_closed']) {
      const kept = scrubPostHogEvent(
        {
          event,
          properties: { setup_profile: 'demo', hours_since_setup: 5, customer_name: 'Ada' },
        },
        { telemetryEnabled: true, accountLinked: false, allowExceptions: false },
      );
      assert.equal(kept?.event, event, `${event} is an allowed usage event`);
      assert.deepEqual(kept?.properties?.setup_profile, 'demo', `${event} keeps the setup profile`);
      assert.equal(
        'customer_name' in (kept?.properties ?? {}),
        false,
        `${event} keeps no unlisted property`,
      );
    }

    await telemetry.stop();

    // Verify PostHog and collector remain suppressed when any gate is closed.
    console.log('Testing suppression gates...');

    // Gate 1: telemetry consent disabled
    setSetting('telemetry_enabled', 'false');
    collectorRequests.length = 0;
    clearCapturedEvents();
    telemetry.start();
    await sendEvent('feature_used', { feature: 'split_checks' });
    await telemetry.stop();
    assert.equal(allCapturedEvents().length, 0, 'No PostHog events when telemetry is disabled');
    assert.equal(collectorRequests.length, 0, 'No collector requests when telemetry is disabled');

    // Gate 2: FLO_MATRIX_OFFLINE=1
    setSetting('telemetry_enabled', 'true');
    process.env.FLO_MATRIX_OFFLINE = '1';
    collectorRequests.length = 0;
    clearCapturedEvents();
    telemetry.start();
    await sendEvent('feature_used', { feature: 'split_checks' });
    await telemetry.stop();
    assert.equal(allCapturedEvents().length, 0, 'No PostHog events under FLO_MATRIX_OFFLINE');
    assert.equal(collectorRequests.length, 0, 'No collector requests under FLO_MATRIX_OFFLINE');
    delete process.env.FLO_MATRIX_OFFLINE;

    // Gate 3: CI=true
    process.env.CI = 'true';
    collectorRequests.length = 0;
    clearCapturedEvents();
    telemetry.start();
    await sendEvent('feature_used', { feature: 'split_checks' });
    await telemetry.stop();
    assert.equal(allCapturedEvents().length, 0, 'No PostHog events under CI');
    assert.equal(collectorRequests.length, 0, 'No collector requests under CI');
    delete process.env.CI;

    // Gate 4: NODE_ENV=test
    process.env.NODE_ENV = 'test';
    collectorRequests.length = 0;
    clearCapturedEvents();
    telemetry.start();
    await sendEvent('feature_used', { feature: 'split_checks' });
    await telemetry.stop();
    assert.equal(allCapturedEvents().length, 0, 'No PostHog events under NODE_ENV=test');
    assert.equal(collectorRequests.length, 0, 'No collector requests under NODE_ENV=test');
    process.env.NODE_ENV = 'development';

    // Gate 5: FLO_POSTHOG_DEV unset in unpackaged dev
    delete process.env.FLO_POSTHOG_DEV;
    collectorRequests.length = 0;
    clearCapturedEvents();
    telemetry.start();
    await sendEvent('feature_used', { feature: 'split_checks' });
    await telemetry.stop();
    assert.equal(allCapturedEvents().length, 0, 'No PostHog events when FLO_POSTHOG_DEV is unset');
    assert.equal(
      collectorRequests.length,
      0,
      'No collector requests when FLO_POSTHOG_DEV is unset',
    );

    console.log('✅ PostHog dev opt-in and suppression checks passed');
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.setInterval = originalSetInterval;
    delete process.env.FLO_POSTHOG_DEV;
    delete process.env.FLO_POSTHOG_DEV_TOKEN;
    delete process.env.FLO_E2E_DB_PATH;
    try {
      closeDatabase();
    } catch {}
    fs.rmSync(testDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
