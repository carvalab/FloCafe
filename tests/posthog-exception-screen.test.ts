/**
 * An exception carries `screen`: the route pattern it happened on, never a URL, query, or id.
 *
 * Usage: npm run test:telemetry
 */
const Module = require('module');
const originalLoad = Module._load;
const fs = require('fs');
const os = require('os');
const path = require('path');
const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flo-exception-screen-'));

Module._load = function (request: string, parent: unknown, isMain: boolean) {
  if (request === 'electron') {
    return { app: { isPackaged: true, getPath: () => testDir, getVersion: () => 'test' } };
  }
  return originalLoad.apply(this, arguments as any);
};

const { assertEqualOrThrow, assertOrThrow } = require('./helpers/test-setup');
const { scrubPostHogEvent } = require('../shared/posthog-scrub');

const on = { telemetryEnabled: true, accountLinked: true, allowExceptions: true };

function scrubException(properties: Record<string, unknown>, options = on) {
  return scrubPostHogEvent({ event: '$exception', properties }, options);
}

function run() {
  console.log('Testing the screen on exceptions...');

  const fromUrl = scrubException({
    capture_point: 'uncaughtException',
    $current_url: 'http://host:3000/orders/42?x=1#y',
    $exception_list: [{ type: 'TypeError', value: 'boom' }],
  });
  assertEqualOrThrow(fromUrl.properties.screen, '/orders/:id', 'the screen is a route pattern');
  const json = JSON.stringify(fromUrl);
  assertEqualOrThrow(json.includes('?'), false, 'no query string leaves the machine');
  assertEqualOrThrow(json.includes('#'), false, 'no hash leaves the machine');
  assertEqualOrThrow(json.includes('host'), false, 'no host leaves the machine');

  // A malformed source must not hide a good one: each is tried in turn.
  const mixedSources = scrubException({
    capture_point: 'uncaughtException',
    screen: 'not a path',
    $pathname: '/pos/orders/42',
    $current_url: 'http://host:3000/settings',
    $exception_list: [{ type: 'Error', value: 'boom' }],
  });
  assertEqualOrThrow(
    mixedSources.properties.screen,
    '/pos/orders/:id',
    'the first usable path becomes the screen',
  );

  // A local API 5xx has no renderer URL, so the route it failed on is the screen.
  const fromRoute = scrubException({
    capture_point: 'api-5xx',
    http_route: '/api/orders/:id',
    http_status: 500,
    $exception_list: [{ type: 'Error', value: '/api/orders/:id' }],
  });
  assertEqualOrThrow(fromRoute.properties.screen, '/api/orders/:id', 'the route is the screen');

  // `<unmatched>` is not a path, so an exception with no matched route keeps no screen.
  const unmatched = scrubException({
    capture_point: 'api-5xx',
    http_route: '<unmatched>',
    http_status: 500,
    $exception_list: [{ type: 'Error', value: 'unmatched' }],
  });
  assertOrThrow(!('screen' in unmatched.properties), 'no route, no screen');

  const screenless = scrubException({
    capture_point: 'uncaughtException',
    $exception_list: [{ type: 'Error', value: 'no path' }],
  });
  assertOrThrow(
    !('screen' in screenless.properties),
    'an exception without a path keeps no screen key at all',
  );

  assertEqualOrThrow(
    scrubException(
      {
        capture_point: 'uncaughtException',
        $pathname: '/pos',
        $exception_list: [{ type: 'Error', value: 'boom' }],
      },
      { ...on, allowExceptions: false },
    ),
    null,
    'a screen does not make an exception leave with diagnostics off',
  );

  console.log('✅ Exception screen checks passed');
}

try {
  run();
} finally {
  Module._load = originalLoad;
  fs.rmSync(testDir, { recursive: true, force: true });
}
