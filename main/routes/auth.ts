import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { randomBytes } from 'crypto';
import { getCurrentSchemaVersion, getDatabase, now } from '../db';

const router = Router();
const JWT_EXPIRES_IN = '24h';
const INITIAL_ADMIN_ROLE = 'owner';
const VALID_BUSINESS_TYPES = new Set(['retail', 'restaurant', 'salon']);

/**
 * Lazy-loaded JWT secret. On first access, reads from the settings table.
 * If no secret exists (first launch), generates a random 32-byte hex string
 * and persists it. This ensures every install gets a unique secret without
 * requiring manual configuration.
 */
let _jwtSecret: string | null = null;

export function getJWTSecret(): string {
  if (_jwtSecret) return _jwtSecret;

  // Environment variable always wins (for CI/testing)
  if (process.env.JWT_SECRET) {
    _jwtSecret = process.env.JWT_SECRET;
    return _jwtSecret;
  }

  try {
    const db = getDatabase();
    const row = db.prepare("SELECT value FROM settings WHERE key = 'jwt_secret'").get() as { value: string } | undefined;

    if (row?.value) {
      _jwtSecret = row.value;
    } else {
      // First launch: generate and persist a random secret
      _jwtSecret = randomBytes(32).toString('hex');
      db.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('jwt_secret', ?, ?)")
        .run(_jwtSecret, now());
      console.log('[Auth] Generated new JWT secret for this install');
    }
  } catch (err) {
    // Database not ready — refuse to operate with a static secret.
    // JWT operations will fail until the database is accessible.
    console.error('[Auth] Database not ready — JWT secret unavailable:', err);
    throw new Error('Database not ready — authentication unavailable');
  }

  return _jwtSecret;
}

/**
 * Build a synthetic "tenant" object from local settings.
 * FloDesktop is single-tenant — there is always exactly one "business".
 * The frontend expects this shape to determine routing (chef → KDS, others → POS).
 */
function buildLocalTenant(db: ReturnType<typeof getDatabase>, userRole: string) {
  const rows = db.prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[];
  const s: Record<string, string> = Object.fromEntries(rows.map(r => [r.key, r.value]));

  return {
    id: 1,
    business_name: s.business_name || 'Store',
    slug: 'local',
    database_name: 'local',
    business_type: s.business_type || 'restaurant',
    country: s.country || 'IN',
    currency: s.currency || 'INR',
    currency_symbol: s.currency_symbol || '₹',
    timezone: s.timezone || 'Asia/Kolkata',
    plan: 'desktop',
    status: 'active',
    role: userRole,  // user's role — AuthGuard uses this for routing
  };
}

function getUserCount(db: ReturnType<typeof getDatabase>): number {
  return (db.prepare('SELECT COUNT(*) as count FROM users').get() as { count: number }).count;
}

function normalizeEmail(email: unknown): string {
  return String(email || '').trim().toLowerCase();
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function upsertSettings(db: ReturnType<typeof getDatabase>, entries: Record<string, unknown>): void {
  const stmt = db.prepare(`
    INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `);

  for (const [key, value] of Object.entries(entries)) {
    if (value !== undefined && value !== null) stmt.run(key, String(value), now());
  }
}

function currencySymbolFor(currency: string): string {
  switch (currency) {
    case 'INR': return '₹';
    case 'USD': return '$';
    case 'EUR': return '€';
    case 'GBP': return '£';
    default: return currency;
  }
}

// ── Rate Limiting (In-Memory for local offline apps) ──────────────────────────
const loginAttempts = new Map<string, { count: number; lockedUntil: number }>();
const MAX_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;

function checkRateLimit(ip: string): { allowed: boolean; waitMinutes?: number } {
  const nowMs = Date.now();
  let record = loginAttempts.get(ip);

  if (record) {
    if (record.lockedUntil > nowMs) {
      const waitMinutes = Math.ceil((record.lockedUntil - nowMs) / 60000);
      return { allowed: false, waitMinutes };
    }
    // If lock expired, reset
    if (record.lockedUntil > 0 && record.lockedUntil <= nowMs) {
      record = { count: 0, lockedUntil: 0 };
      loginAttempts.set(ip, record);
    }
  }
  return { allowed: true };
}

function incrementFailedLogin(ip: string) {
  const record = loginAttempts.get(ip) || { count: 0, lockedUntil: 0 };
  record.count += 1;
  if (record.count >= MAX_ATTEMPTS) {
    record.lockedUntil = Date.now() + LOCKOUT_MINUTES * 60000;
  }
  loginAttempts.set(ip, record);
}

function resetSuccessfulLogin(ip: string) {
  loginAttempts.delete(ip);
}
// ─────────────────────────────────────────────────────────────────────────────

// ── POST /api/auth/login ──────────────────────────────────────────────────────

router.post('/login', (req: Request, res: Response) => {
  try {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const rateLimit = checkRateLimit(ip);
    if (!rateLimit.allowed) {
      return res.status(429).json({ error: `Too many failed attempts. Try again in ${rateLimit.waitMinutes} minutes.` });
    }

    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }

    const db = getDatabase();
    const user = db.prepare('SELECT * FROM users WHERE email = ? AND is_active = 1').get(email) as any;

    if (!user || !bcrypt.compareSync(password, user.password)) {
      incrementFailedLogin(ip);
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    resetSuccessfulLogin(ip);

    const token = jwt.sign(
      { userId: user.id, email: user.email, role: user.role },
      getJWTSecret(),
      { expiresIn: JWT_EXPIRES_IN }
    );

    const tenant = buildLocalTenant(db, user.role);

    res.json({
      access_token: token,
      token_type: 'bearer',
      expires_in: 86400,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        category_ids: user.category_ids ? JSON.parse(user.category_ids) : [],
      },
      // Single tenant — frontend auto-selects when tenants.length === 1
      tenants: [tenant],
    });
  } catch (error: any) {
    console.error('[Auth] Login error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ── POST /api/auth/tenants/select ─────────────────────────────────────────────
// Frontend calls this after login (even when auto-selecting the single tenant).

router.post('/tenants/select', (req: Request, res: Response) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, getJWTSecret()) as any;

    const db = getDatabase();
    const user = db.prepare('SELECT id, name, email, role FROM users WHERE id = ?').get(decoded.userId) as any;
    if (!user) return res.status(404).json({ error: 'User not found' });

    const tenant = buildLocalTenant(db, user.role);

    // Re-issue token with tenant context embedded (same payload — desktop is single-tenant)
    const newToken = jwt.sign(
      { userId: user.id, email: user.email, role: user.role, tenantId: 1 },
      getJWTSecret(),
      { expiresIn: JWT_EXPIRES_IN }
    );

    res.json({
      access_token: newToken,
      token_type: 'bearer',
      tenant,
    });
  } catch (error: any) {
    res.status(401).json({ error: 'Invalid token' });
  }
});

// ── POST /api/auth/logout ─────────────────────────────────────────────────────

router.post('/logout', (_req: Request, res: Response) => {
  res.json({ message: 'Logged out successfully' });
});

// ── POST /api/auth/refresh ────────────────────────────────────────────────────

router.post('/refresh', (req: Request, res: Response) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, getJWTSecret()) as any;
    const newToken = jwt.sign(
      { userId: decoded.userId, email: decoded.email, role: decoded.role, tenantId: decoded.tenantId },
      getJWTSecret(),
      { expiresIn: JWT_EXPIRES_IN }
    );

    res.json({
      access_token: newToken,
      token_type: 'bearer',
      expires_in: 86400,
    });
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
});

// ── GET /api/auth/me ──────────────────────────────────────────────────────────

router.get('/me', (req: Request, res: Response) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, getJWTSecret()) as any;

    const db = getDatabase();
    const user = db.prepare('SELECT id, name, email, role FROM users WHERE id = ?').get(decoded.userId) as any;
    if (!user) return res.status(404).json({ error: 'User not found' });

    const tenant = buildLocalTenant(db, user.role);

    res.json({
      user,
      tenants: [tenant],
    });
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
});

// ── POST /api/auth/password/change ────────────────────────────────────────────

router.post('/password/change', (req: Request, res: Response) => {
  try {
    const { current_password, password } = req.body;
    const authHeader = req.headers.authorization;

    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, getJWTSecret()) as any;

    const db = getDatabase();
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(decoded.userId) as any;
    if (!user) return res.status(404).json({ error: 'User not found' });

    if (!bcrypt.compareSync(current_password, user.password)) {
      return res.status(400).json({ error: 'Current password is incorrect' });
    }

    const hashedPassword = bcrypt.hashSync(password, 10);
    db.prepare('UPDATE users SET password = ?, updated_at = ? WHERE id = ?').run(hashedPassword, now(), decoded.userId);

    res.json({ message: 'Password changed successfully' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ── GET /api/auth/setup/status ──────────────────────────────────────────────────
// Returns whether the app needs setup (no users exist yet)

router.get('/setup/status', (_req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const userCount = getUserCount(db);
    const needsSetup = userCount === 0;
    res.json({
      needsSetup,
      userCount,
      initialRole: INITIAL_ADMIN_ROLE,
      schemaVersion: getCurrentSchemaVersion(),
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ── POST /api/auth/setup/initialize ─────────────────────────────────────────────
// Creates the initial owner user. This endpoint is disabled after any user exists.

router.post('/setup/initialize', (req: Request, res: Response) => {
  try {
    const {
      name,
      password,
      business_type = 'restaurant',
      business_name,
      store_name,
      country = 'IN',
      currency = 'INR',
      currency_symbol,
      timezone = 'Asia/Kolkata',
      business_address,
      address,
      business_phone,
      phone,
      gstin,
      state_code,
      tax_registered,
      billing_type,
    } = req.body;
    const email = normalizeEmail(req.body.email);
    const displayName = String(name || '').trim();
    const normalizedBusinessType = String(business_type || 'restaurant').trim();
    const normalizedCurrency = String(currency || 'INR').trim().toUpperCase();
    const storeName = String(store_name || business_name || '').trim();
    const resolvedStoreName = storeName || 'Store';
    const outletAddress = String(business_address || address || '').trim();
    const outletPhone = String(business_phone || phone || '').trim();

    if (!displayName || !email || !password) {
      return res.status(400).json({ error: 'Name, email, and password are required' });
    }

    if (!isValidEmail(email)) {
      return res.status(400).json({ error: 'A valid email is required' });
    }

    if (String(password).length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    if (!VALID_BUSINESS_TYPES.has(normalizedBusinessType)) {
      return res.status(400).json({ error: 'Invalid business type' });
    }

    const db = getDatabase();
    const beforeCount = getUserCount(db);
    if (beforeCount > 0) {
      return res.status(403).json({ error: 'Setup already complete. This endpoint is disabled.' });
    }

    let userId = '';
    const hashedPassword = bcrypt.hashSync(password, 10);

    db.transaction(() => {
      const userCount = getUserCount(db);
      if (userCount > 0) {
        throw new Error('Setup already complete. This endpoint is disabled.');
      }

      const existingUser = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
      if (existingUser) {
        throw new Error('User with this email already exists');
      }

      userId = uuidv4();
      db.prepare(`
        INSERT INTO users (id, name, email, password, role, is_active, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(userId, displayName, email, hashedPassword, INITIAL_ADMIN_ROLE, 1, now(), now());

      upsertSettings(db, {
        business_name: resolvedStoreName,
        business_type: normalizedBusinessType,
        country,
        currency: normalizedCurrency,
        currency_symbol: currency_symbol || currencySymbolFor(normalizedCurrency),
        timezone,
        business_address: outletAddress,
        business_phone: outletPhone,
        address: outletAddress,
        phone: outletPhone,
        email,
        gstin,
        state_code,
        tax_registered,
        billing_type,
        onboarding_completed: 'true',
      });
    })();

    const token = jwt.sign(
      { userId, email, role: INITIAL_ADMIN_ROLE },
      getJWTSecret(),
      { expiresIn: JWT_EXPIRES_IN }
    );

    const tenant = buildLocalTenant(db, INITIAL_ADMIN_ROLE);

    res.json({
      access_token: token,
      token_type: 'bearer',
      expires_in: 86400,
      user: { id: userId, name: displayName, email, role: INITIAL_ADMIN_ROLE },
      tenant,
      tenants: [tenant],
    });
  } catch (error: any) {
    console.error('[Auth] Setup error:', error);
    const message = error.message || 'Setup failed';
    const status = message.includes('already complete') ? 403
      : message.includes('already exists') ? 400
        : 500;
    res.status(status).json({ error: message });
  }
});

// ── POST /api/auth/setup/seed ───────────────────────────────────────────────────
// Seeds demo data for the selected business type

router.post('/setup/seed', (req: Request, res: Response) => {
  try {
    const { business_type, business_name, password } = req.body;
    const normalizedBusinessType = String(business_type || 'restaurant').trim();

    if (!VALID_BUSINESS_TYPES.has(normalizedBusinessType)) {
      return res.status(400).json({ error: 'Invalid business type' });
    }

    if (!password || String(password).length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    const db = getDatabase();

    // ── Security: only allowed during first-run (no users exist yet) ──────────
    const userCount = getUserCount(db);
    if (userCount > 0) {
      return res.status(403).json({ error: 'Setup already complete. This endpoint is disabled.' });
    }
    // ─────────────────────────────────────────────────────────────────────────

    if (business_name) {
      db.prepare(`INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('business_name', ?, ?)`).run(business_name, now());
    }
    db.prepare(`INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('business_type', ?, ?)`).run(normalizedBusinessType, now());
    db.prepare(`INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('onboarding_completed', 'true', ?)`).run(now());

    const hashedPassword = bcrypt.hashSync(String(password), 10);
    const ownerId = uuidv4();
    db.prepare(`
      INSERT OR IGNORE INTO users (id, name, email, password, role, is_active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(ownerId, 'Owner', 'admin@flo.local', hashedPassword, 'owner', 1, now(), now());

    if (normalizedBusinessType === 'restaurant') {
      const cats = [
        ['cat-1', 'Starters', '#FF6B6B', '🍔', 1],
        ['cat-2', 'Main Course', '#4ECDC4', '🍛', 2],
        ['cat-3', 'Beverages', '#45B7D1', '🥤', 3],
        ['cat-4', 'Desserts', '#96CEB4', '🍰', 4],
      ];
      for (const [id, name, color, icon, sort] of cats) {
        db.prepare(`INSERT OR IGNORE INTO categories (id, name, color, icon, sort_order) VALUES (?, ?, ?, ?, ?)`).run(id, name, color, icon, sort);
      }
      const products = [
        ['prod-1', 'cat-1', 'Paneer Tikka', 250, 1],
        ['prod-2', 'cat-1', 'Chicken Wings', 280, 2],
        ['prod-3', 'cat-2', 'Butter Chicken', 320, 1],
        ['prod-4', 'cat-2', 'Dal Makhani', 220, 2],
        ['prod-5', 'cat-2', 'Jeera Rice', 150, 3],
        ['prod-6', 'cat-3', 'Cola', 60, 1],
        ['prod-7', 'cat-3', 'Lemon Soda', 70, 2],
        ['prod-8', 'cat-4', 'Gulab Jamun', 80, 1],
      ];
      for (const [id, catId, name, price, sort] of products) {
        db.prepare(`INSERT OR IGNORE INTO products (id, category_id, name, price, sort_order, is_active) VALUES (?, ?, ?, ?, ?, 1)`).run(id, catId, name, price, sort);
      }
      const tables = [['tbl-1', 'T1', 4], ['tbl-2', 'T2', 4], ['tbl-3', 'T3', 6]];
      for (const [id, number, capacity] of tables) {
        db.prepare(`INSERT OR IGNORE INTO tables (id, number, capacity) VALUES (?, ?, ?)`).run(id, number, capacity);
      }
    } else if (normalizedBusinessType === 'retail') {
      const cats = [
        ['cat-1', 'Electronics', '#3B82F6', '📱', 1],
        ['cat-2', 'Clothing', '#8B5CF6', '👕', 2],
        ['cat-3', 'Groceries', '#10B981', '🛒', 3],
      ];
      for (const [id, name, color, icon, sort] of cats) {
        db.prepare(`INSERT OR IGNORE INTO categories (id, name, color, icon, sort_order) VALUES (?, ?, ?, ?, ?)`).run(id, name, color, icon, sort);
      }
      const products = [
        ['prod-1', 'cat-1', 'USB Cable', 199, 1],
        ['prod-2', 'cat-1', 'Phone Case', 349, 2],
        ['prod-3', 'cat-2', 'T-Shirt', 599, 1],
        ['prod-4', 'cat-2', 'Jeans', 1299, 2],
        ['prod-5', 'cat-3', 'Rice 5kg', 450, 1],
        ['prod-6', 'cat-3', 'Cooking Oil 1L', 180, 2],
      ];
      for (const [id, catId, name, price, sort] of products) {
        db.prepare(`INSERT OR IGNORE INTO products (id, category_id, name, price, sort_order, is_active) VALUES (?, ?, ?, ?, ?, 1)`).run(id, catId, name, price, sort);
      }
    } else if (normalizedBusinessType === 'salon') {
      const cats = [
        ['cat-1', 'Hair', '#EC4899', '✂️', 1],
        ['cat-2', 'Facial', '#F59E0B', '💆', 2],
        ['cat-3', 'Massage', '#6366F1', '🧘', 3],
      ];
      for (const [id, name, color, icon, sort] of cats) {
        db.prepare(`INSERT OR IGNORE INTO categories (id, name, color, icon, sort_order) VALUES (?, ?, ?, ?, ?)`).run(id, name, color, icon, sort);
      }
      const products = [
        ['prod-1', 'cat-1', 'Haircut', 250, 1],
        ['prod-2', 'cat-1', 'Hair Coloring', 1500, 2],
        ['prod-3', 'cat-2', 'Classic Facial', 800, 1],
        ['prod-4', 'cat-2', 'Gold Facial', 2000, 2],
        ['prod-5', 'cat-3', 'Body Massage', 1200, 1],
      ];
      for (const [id, catId, name, price, sort] of products) {
        db.prepare(`INSERT OR IGNORE INTO products (id, category_id, name, price, sort_order, is_active) VALUES (?, ?, ?, ?, ?, 1)`).run(id, catId, name, price, sort);
      }
    }

    res.json({ message: 'Demo data seeded successfully' });
  } catch (error: any) {
    console.error('[Auth] Seed error:', error);
    res.status(500).json({ error: error.message });
  }
});

export const authRoutes = router;
