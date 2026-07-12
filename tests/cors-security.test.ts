import { isAllowedPrivateIp, rateLimit } from '../main/middleware/security';
import express from 'express';
import request from 'supertest';

async function run() {
  console.log('Testing CORS IP Validation...');
  
  const assert = (condition: boolean, msg: string) => {
    if (!condition) {
      throw new Error(`Assertion failed: ${msg}`);
    }
  };

  // 1. Localhost
  assert(isAllowedPrivateIp('127.0.0.1') === true, 'Should allow IPv4 loopback');
  assert(isAllowedPrivateIp('::1') === true, 'Should allow IPv6 loopback');

  // 2. Private LAN IPs
  assert(isAllowedPrivateIp('192.168.1.100') === true, 'Should allow 192.168.x.x');
  assert(isAllowedPrivateIp('10.0.0.50') === true, 'Should allow 10.x.x.x');
  assert(isAllowedPrivateIp('172.16.0.1') === true, 'Should allow 172.16.x.x');
  assert(isAllowedPrivateIp('172.31.255.255') === true, 'Should allow 172.31.x.x');

  // 3. Tailscale CGNAT IPs
  assert(isAllowedPrivateIp('100.64.0.1') === true, 'Should allow lower bound Tailscale');
  assert(isAllowedPrivateIp('100.127.255.255') === true, 'Should allow upper bound Tailscale');
  assert(isAllowedPrivateIp('100.100.100.100') === true, 'Should allow middle Tailscale');

  // 4. Disallowed IPs (Public and Out of bounds)
  assert(isAllowedPrivateIp('8.8.8.8') === false, 'Should reject public IP');
  assert(isAllowedPrivateIp('100.63.255.255') === false, 'Should reject out of bound CGNAT (low)');
  assert(isAllowedPrivateIp('100.128.0.0') === false, 'Should reject out of bound CGNAT (high)');
  assert(isAllowedPrivateIp('172.15.255.255') === false, 'Should reject out of bound Class B (low)');
  assert(isAllowedPrivateIp('172.32.0.0') === false, 'Should reject out of bound Class B (high)');
  assert(isAllowedPrivateIp('192.169.0.1') === false, 'Should reject out of bound Class C');

  // 5. Malformed/Spoofed
  assert(isAllowedPrivateIp('10.evil.com') === false, 'Should reject spoofed domains');
  assert(isAllowedPrivateIp('100.64.0') === false, 'Should reject incomplete IP');
  assert(isAllowedPrivateIp('localhost') === false, 'localhost string itself is not an IP');

  // 6. Rate Limiter Bypass Tests
  console.log('Testing Rate Limiter Bypass...');
  
  const createRateLimitedApp = (maxRequests: number, ipOverride?: string) => {
    const app = express();
    if (ipOverride) {
      app.use((req, res, next) => {
        Object.defineProperty(req, 'ip', {
          get: () => ipOverride,
          configurable: true
        });
        next();
      });
    }
    app.use(rateLimit({ windowMs: 60 * 1000, max: maxRequests }));
    app.get('/test', (req, res) => {
      res.status(200).json({ ok: true });
    });
    return app;
  };

  // Test that public IPs get rate limited
  const publicApp = createRateLimitedApp(2, '8.8.8.8');
  let res = await request(publicApp).get('/test');
  assert(res.status === 200, 'Public IP first request should be OK');
  res = await request(publicApp).get('/test');
  assert(res.status === 200, 'Public IP second request should be OK');
  res = await request(publicApp).get('/test');
  assert(res.status === 429, 'Public IP third request should be rate limited');

  // Test that private/local IPs do NOT get rate limited
  const privateApp = createRateLimitedApp(2, '192.168.1.100');
  for (let i = 0; i < 5; i++) {
    const resPrivate = await request(privateApp).get('/test');
    assert(resPrivate.status === 200, `Private IP request ${i + 1} should bypass rate limiting`);
  }

  // Test IPv6 loopback
  const loopbackV6App = createRateLimitedApp(2, '::1');
  for (let i = 0; i < 5; i++) {
    const resPrivate = await request(loopbackV6App).get('/test');
    assert(resPrivate.status === 200, `IPv6 loopback request ${i + 1} should bypass rate limiting`);
  }

  // Test IPv4-mapped IPv6 address (::ffff:127.0.0.1)
  const mappedV4App = createRateLimitedApp(2, '::ffff:127.0.0.1');
  for (let i = 0; i < 5; i++) {
    const resPrivate = await request(mappedV4App).get('/test');
    assert(resPrivate.status === 200, `IPv4-mapped IPv6 request ${i + 1} should bypass rate limiting`);
  }

  console.log('✅ All CORS IP Validation & Rate Limiter tests passed!');
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
