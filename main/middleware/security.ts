import { Request, Response, NextFunction } from 'express';

interface RateLimitRecord {
  count: number;
  resetAt: number;
}

interface RateLimitOptions {
  windowMs?: number;
  max?: number;
  message?: string;
  skipSuccessfulRequests?: boolean;
  /** When false, private/LAN IPs are NOT exempt — use for auth endpoints. Default: true. */
  bypassPrivateIp?: boolean;
}

const DEFAULT_WINDOW_MS = 60 * 1000; // 1 minute
const DEFAULT_MAX = 100;

/**
 * Simple in-memory rate limiter for the local Express API.
 * Uses IP address as the key. Designed for a single-tenant desktop app.
 */
export function rateLimit(options: RateLimitOptions = {}) {
  const windowMs = options.windowMs ?? DEFAULT_WINDOW_MS;
  const max = options.max ?? DEFAULT_MAX;
  const message = options.message ?? 'Too many requests, please try again later.';

  const requests = new Map<string, RateLimitRecord>();

  return (req: Request, res: Response, next: NextFunction) => {
    let ip = req.ip || req.socket.remoteAddress || 'unknown';
    const now = Date.now();

    // Normalize IPv4-mapped IPv6 address (e.g. ::ffff:127.0.0.1 -> 127.0.0.1)
    const normalizedIp = ip.startsWith('::ffff:') ? ip.substring(7) : ip;

    // Bypass rate limit for local / private / Tailscale IPs (general API traffic).
    // Auth endpoints opt out of this bypass via bypassPrivateIp: false so that
    // LAN-based brute-force against /api/auth/login is still throttled.
    const bypassPrivateIp = options.bypassPrivateIp !== false;
    if (bypassPrivateIp && isAllowedPrivateIp(normalizedIp)) {
      return next();
    }

    let record = requests.get(ip);
    if (!record || record.resetAt <= now) {
      record = { count: 0, resetAt: now + windowMs };
      requests.set(ip, record);
    }

    record.count += 1;

    res.setHeader('RateLimit-Limit', String(max));
    res.setHeader('RateLimit-Remaining', String(Math.max(0, max - record.count)));
    res.setHeader('RateLimit-Reset', new Date(record.resetAt).toISOString());

    if (record.count > max) {
      return res.status(429).json({ error: message });
    }

    if (options.skipSuccessfulRequests) {
      const originalSend = res.send.bind(res);
      res.send = (body: any) => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          record!.count = Math.max(0, record!.count - 1);
        }
        return originalSend(body);
      };
    }

    next();
  };
}

/**
 * Stricter rate limiter for authentication endpoints.
 * Private/LAN IPs are NOT exempt — LAN-based brute-force is a real threat
 * for a POS system. (vuln-0003)
 */
export function authRateLimit() {
  return rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 10,
    message: 'Too many authentication attempts. Please try again later.',
    bypassPrivateIp: false,
  });
}

/**
 * Role-based authorization middleware.
 * Must be used after requireAuth.
 */
export function requireRole(...roles: string[]) {
  return (req: Request, res: Response, next: () => void) => {
    const user = (req as any).user;
    if (!user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    if (!roles.includes(user.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  };
}

import { URL } from 'url';
import * as net from 'net';

/**
 * Checks if the given IP address is a private, local, or Tailscale IP.
 */
export function isAllowedPrivateIp(ip: string): boolean {
  if (!net.isIP(ip)) return false; 
  if (ip === '::1') return true;

  const parts = ip.split('.').map(Number);
  if (parts.length !== 4) return false;
  const [a, b] = parts;

  // Localhost (127.0.0.0/8)
  if (a === 127) return true;
  // Private Class A (10.0.0.0/8)
  if (a === 10) return true;
  // Private Class B (172.16.0.0/12)
  if (a === 172 && b >= 16 && b <= 31) return true;
  // Private Class C (192.168.0.0/16)
  if (a === 192 && b === 168) return true;
  
  // Tailscale CGNAT (100.64.0.0/10)
  if (a === 100 && b >= 64 && b <= 127) return true;

  return false;
}

export const corsOptions = {
  origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
    if (!origin) return callback(null, true);

    try {
      const parsedOrigin = new URL(origin);
      const hostname = parsedOrigin.hostname;

      if (hostname === 'localhost' || hostname.endsWith('.local') || isAllowedPrivateIp(hostname)) {
        return callback(null, true);
      }
      
      callback(new Error('Not allowed by CORS'));
    } catch (err) {
      callback(new Error('Invalid origin format'));
    }
  }
};

/**
 * Validates password complexity (vuln-0006).
 * Requires: >= 8 characters, at least 1 uppercase, 1 lowercase, 1 digit.
 */
export function validatePassword(password: string): boolean {
  if (!password || password.length < 8) return false;
  if (!/[A-Z]/.test(password)) return false;
  if (!/[a-z]/.test(password)) return false;
  if (!/[0-9]/.test(password)) return false;
  return true;
}
