import { isAllowedPrivateIp } from '../main/middleware/security';

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

  console.log('✅ All CORS IP Validation tests passed!');
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
