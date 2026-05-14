import Database from 'better-sqlite3';
import * as path from 'path';
import { app } from 'electron';
import * as fs from 'fs';
import * as bcrypt from 'bcryptjs';

// Bump this whenever the schema changes incompatibly
export const SCHEMA_VERSION = 9;

let db: Database.Database;

export function getDbPath(): string {
  const userDataPath = app.isPackaged ? app.getPath('userData') : path.join(__dirname, '../../');
  return path.join(userDataPath, 'flo.db');
}

function getBackupDir(): string {
  const userDataPath = app.getPath('userData');
  return path.join(userDataPath, 'backups');
}

export function initDatabase(): void {
  const dbPath = getDbPath();
  const backupDir = getBackupDir();

  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }

  console.log(`[DB] Opening database at: ${dbPath}`);
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('busy_timeout = 5000');
  db.pragma('foreign_keys = OFF'); // Off during migrations

  runMigrations();

  db.pragma('foreign_keys = ON');

  runStartupIntegrityCheck();
  autoRepairPaymentDetails();
}

/** Atomic multi-statement mutation. Use for anything touching >1 row or >1 table. */
export function withTxn<T>(fn: () => T): T {
  return db.transaction(fn)();
}

/** Safely append an object to a JSON-array column. Creates the array if missing/invalid. */
export function appendJsonArray(table: string, idColumn: string, idValue: any, column: string, value: any): void {
  const row = db.prepare(`SELECT ${column} AS v FROM ${table} WHERE ${idColumn} = ?`).get(idValue) as any;
  let arr: any[] = [];
  if (row && row.v) {
    try {
      const parsed = JSON.parse(row.v);
      arr = Array.isArray(parsed) ? parsed : [parsed];
    } catch {
      arr = [];
    }
  }
  arr.push(value);
  db.prepare(`UPDATE ${table} SET ${column} = ? WHERE ${idColumn} = ?`).run(JSON.stringify(arr), idValue);
}

/** Runs on every startup. Logs loud warnings but never throws — DB stays available even if dirty. */
function runStartupIntegrityCheck(): void {
  try {
    const integrity = db.prepare('PRAGMA integrity_check').all() as { integrity_check: string }[];
    const bad = integrity.filter((r) => r.integrity_check !== 'ok');
    if (bad.length > 0) {
      console.error('[DB] ⚠ integrity_check reported issues:', bad.map((r) => r.integrity_check).join('; '));
    } else {
      console.log('[DB] integrity_check: ok');
    }

    const fkViolations = db.prepare('PRAGMA foreign_key_check').all() as any[];
    if (fkViolations.length > 0) {
      console.error(`[DB] ⚠ ${fkViolations.length} foreign-key violation(s):`, fkViolations.slice(0, 5));
    } else {
      console.log('[DB] foreign_key_check: clean');
    }
  } catch (err: any) {
    console.error('[DB] Startup integrity check failed:', err.message);
  }
}

/** Idempotent auto-repair for the pre-fix payment_details corruption: `{A},{A}` → `[A]`.
 *  Only runs when rows are detected as malformed AND the deduped sum matches `paid_amount`. */
function autoRepairPaymentDetails(): void {
  try {
    const rows = db.prepare(`SELECT id, payment_details, paid_amount FROM bills WHERE payment_details IS NOT NULL AND payment_details != ''`).all() as any[];
    const toFix: { id: number; value: string }[] = [];

    for (const row of rows) {
      try { JSON.parse(row.payment_details); continue; } catch {}

      const wrapped = '[' + String(row.payment_details).replace(/\}\s*,\s*\{/g, '},{') + ']';
      let parsed: any[];
      try { parsed = JSON.parse(wrapped); } catch { continue; }
      if (!Array.isArray(parsed)) continue;

      const deduped: any[] = [];
      for (const p of parsed) {
        const prev = deduped[deduped.length - 1];
        if (prev && prev.method === p.method && prev.amount === p.amount && prev.timestamp === p.timestamp) continue;
        deduped.push(p);
      }

      const dedupedSum = deduped.reduce((s, p) => s + (Number(p.amount) || 0), 0);
      const rawSum = parsed.reduce((s, p) => s + (Number(p.amount) || 0), 0);
      const chosen = Math.abs(dedupedSum - row.paid_amount) <= 0.02 ? deduped
                    : Math.abs(rawSum - row.paid_amount) <= 0.02 ? parsed : null;
      if (!chosen) continue;

      toFix.push({ id: row.id, value: JSON.stringify(chosen) });
    }

    if (toFix.length === 0) return;

    const stmt = db.prepare(`UPDATE bills SET payment_details = ?, updated_at = datetime('now') WHERE id = ?`);
    const tx = db.transaction((rows: { id: number; value: string }[]) => {
      for (const r of rows) stmt.run(r.value, r.id);
    });
    tx(toFix);
    console.log(`[DB] auto-repaired payment_details on ${toFix.length} bill(s)`);
  } catch (err: any) {
    console.error('[DB] autoRepairPaymentDetails failed:', err.message);
  }
}

export function getDatabase(): Database.Database {
  if (!db) throw new Error('Database not initialized');
  return db;
}

export function closeDatabase(): void {
  if (db) {
    db.close();
    console.log('[DB] Database closed');
  }
}

export async function createBackup(targetPath?: string): Promise<{ path: string; schemaVersion: number }> {
  console.log('[DB] createBackup: Starting...');
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupDir = getBackupDir();
  
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }
  
  const backupPath = targetPath || path.join(backupDir, `flo-backup-${timestamp}.db`);
  console.log('[DB] createBackup: Target path:', backupPath);
  
  await db.backup(backupPath);
  
  const backupDb = new Database(backupPath);
  backupDb.exec(`
    CREATE TABLE IF NOT EXISTS _flo_meta (
      key TEXT PRIMARY KEY,
      value TEXT
    )
  `);
  
  const currentVersion = getCurrentSchemaVersion();
  backupDb.prepare(`INSERT OR REPLACE INTO _flo_meta (key, value) VALUES (?, ?)`)
    .run('schema_version', String(currentVersion));
  backupDb.prepare(`INSERT OR REPLACE INTO _flo_meta (key, value) VALUES (?, ?)`)
    .run('backup_created_at', new Date().toISOString());
  backupDb.prepare(`INSERT OR REPLACE INTO _flo_meta (key, value) VALUES (?, ?)`)
    .run('app_version', app.getVersion());
  backupDb.close();
  
  console.log(`[DB] Backup created: ${backupPath} (schema v${currentVersion})`);
  return { path: backupPath, schemaVersion: currentVersion };
}

function getColumns(dbInstance: Database.Database, tableName: string): string[] {
  try {
    const columns = dbInstance.prepare(`PRAGMA table_info(${tableName})`).all() as { name: string }[];
    return columns.map(col => col.name);
  } catch {
    return [];
  }
}

function getTables(dbInstance: Database.Database): string[] {
  try {
    const tables = dbInstance.prepare(`
      SELECT name FROM sqlite_master WHERE type='table' 
      AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_flo_meta'
    `).all() as { name: string }[];
    return tables.map(t => t.name);
  } catch {
    return [];
  }
}

export interface RestoreResult {
  success: boolean;
  mode: 'direct' | 'data_only' | 'full';
  backupSchemaVersion: number;
  currentSchemaVersion: number;
  tablesRestored: number;
  error?: string;
}

export function restoreBackup(backupPath: string, forceDirect: boolean = false): RestoreResult {
  console.log('[DB] restoreBackup: Starting restore from:', backupPath);
  
  const backupDb = new Database(backupPath, { readonly: true });
  
  const metaRow = backupDb.prepare(`SELECT value FROM _flo_meta WHERE key = 'schema_version'`).get() as { value: string } | undefined;
  const backupSchemaVersion = metaRow ? parseInt(metaRow.value, 10) : 0;
  backupDb.close();
  
  console.log(`[DB] Backup schema version: ${backupSchemaVersion}, Current: ${SCHEMA_VERSION}`);
  
  const currentDb = getDatabase();
  const currentVersion = getCurrentSchemaVersion();
  
  if (forceDirect || backupSchemaVersion === currentVersion) {
    console.log('[DB] restoreBackup: Direct restore (same schema version)');
    closeDatabase();
    const dbPath = getDbPath();
    fs.copyFileSync(backupPath, dbPath);
    initDatabase();
    
    return {
      success: true,
      mode: 'direct',
      backupSchemaVersion,
      currentSchemaVersion: currentVersion,
      tablesRestored: getTables(currentDb).length
    };
  }
  
  console.log('[DB] restoreBackup: Data-only restore (schema version mismatch)');
  return dataOnlyRestore(backupPath, backupSchemaVersion, currentVersion);
}

function dataOnlyRestore(backupPath: string, backupVersion: number, currentVersion: number): RestoreResult {
  const backupDb = new Database(backupPath, { readonly: true });
  const currentDb = getDatabase();
  
  const backupTables = getTables(backupDb);
  const currentTables = getTables(currentDb);
  
  const commonTables = backupTables.filter(t => currentTables.includes(t));
  let tablesRestored = 0;
  
  currentDb.exec('BEGIN IMMEDIATE');
  
  try {
    for (const tableName of commonTables) {
      const backupCols = getColumns(backupDb, tableName);
      const currentCols = getColumns(currentDb, tableName);
      const commonCols = backupCols.filter(c => currentCols.includes(c));
      
      if (commonCols.length === 0) continue;
      
      currentDb.exec(`DELETE FROM ${tableName}`);
      
      const colList = commonCols.join(', ');
      currentDb.exec(`
        ATTACH DATABASE '${backupPath}' AS backup;
        INSERT INTO ${tableName} (${colList}) SELECT ${colList} FROM backup.${tableName}
      `);
      
      tablesRestored++;
      console.log(`[DB] Restored ${tableName}: ${commonCols.length} columns`);
    }
    
    currentDb.exec('COMMIT');
    
    return {
      success: true,
      mode: 'data_only',
      backupSchemaVersion: backupVersion,
      currentSchemaVersion: currentVersion,
      tablesRestored
    };
  } catch (error: any) {
    currentDb.exec('ROLLBACK');
    console.error('[DB] dataOnlyRestore failed:', error);
    return {
      success: false,
      mode: 'data_only',
      backupSchemaVersion: backupVersion,
      currentSchemaVersion: currentVersion,
      tablesRestored: 0,
      error: error.message
    };
  } finally {
    backupDb.close();
  }
}

export function getSchemaVersionFromBackup(backupPath: string): number {
  try {
    const backupDb = new Database(backupPath, { readonly: true });
    const metaRow = backupDb.prepare(`SELECT value FROM _flo_meta WHERE key = 'schema_version'`).get() as { value: string } | undefined;
    backupDb.close();
    return metaRow ? parseInt(metaRow.value, 10) : 0;
  } catch {
    return 0;
  }
}

function getCurrentSchemaVersion(): number {
  try {
    const row = db.prepare("SELECT value FROM settings WHERE key = 'schema_version'").get() as any;
    return row ? parseInt(row.value, 10) : 0;
  } catch {
    return 0;
  }
}

function runMigrations(): void {
  console.log('[DB] Running migrations...');

  // Bootstrap: create settings table to check version
  db.exec(`CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`);

  const currentVersion = getCurrentSchemaVersion();
  console.log(`[DB] Schema version: ${currentVersion} → ${SCHEMA_VERSION}`);

  if (currentVersion === 0) {
    // Fresh install - create everything
    createSchema();
    seedData();
  } else if (currentVersion < SCHEMA_VERSION) {
    // Incremental migrations
    runIncrementalMigrations(currentVersion);
  }

  console.log('[DB] Migrations complete');
}

function runIncrementalMigrations(fromVersion: number): void {
  const insert = (key: string, value: string) =>
    db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)').run(key, value);

  // Migration from version 7 to 8
  if (fromVersion < 8) {
    console.log('[DB] Running migration to v8...');
    
    // Add printers table if it doesn't exist
    db.exec(`CREATE TABLE IF NOT EXISTS printers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      connection_type TEXT NOT NULL CHECK (connection_type IN ('network', 'usb', 'webusb')),
      ip_address TEXT,
      port INTEGER DEFAULT 9100,
      usb_device_path TEXT,
      is_default INTEGER DEFAULT 0,
      paper_width TEXT DEFAULT '80mm',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`);

    // Add default printer if none exists
    const existingPrinter = db.prepare('SELECT COUNT(*) as count FROM printers').get() as any;
    if (!existingPrinter || existingPrinter.count === 0) {
      db.prepare(`
        INSERT INTO printers (id, name, connection_type, paper_width, is_default)
        VALUES (?, ?, ?, ?, ?)
      `).run('printer-1', 'Thermal Printer', 'usb', '80mm', 1);
      console.log('[DB] Added default printer');
    }
  }

  // Migration from version 8 to 9
  if (fromVersion < 9) {
    console.log('[DB] Running migration to v9...');
    try {
      db.exec(`ALTER TABLE customers ADD COLUMN tag_counts TEXT DEFAULT NULL`);
      console.log('[DB] Added tag_counts column to customers');
    } catch (e: any) {
      if (!e.message?.includes('duplicate column')) throw e;
    }
  }

  // Update schema version
  insert('schema_version', String(SCHEMA_VERSION));
  console.log('[DB] Incremental migration complete');
}

function createSchema(): void {
  db.exec(`
    -- ── Master data tables ──────────────────────────────────────────────

    CREATE TABLE IF NOT EXISTS categories (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      image_url TEXT,
      sort_order INTEGER DEFAULT 0,
      is_active INTEGER DEFAULT 1,
      parent_id TEXT,
      slug TEXT,
      color TEXT,
      icon TEXT,
      deleted_at TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY,
      category_id TEXT,
      name TEXT NOT NULL,
      description TEXT,
      price REAL NOT NULL DEFAULT 0,
      cost REAL DEFAULT 0,
      sku TEXT,
      barcode TEXT,
      image_url TEXT,
      is_active INTEGER DEFAULT 1,
      sort_order INTEGER DEFAULT 0,
      track_inventory INTEGER DEFAULT 0,
      stock_quantity REAL DEFAULT 0,
      low_stock_threshold REAL DEFAULT 5,
      tax_type TEXT DEFAULT 'none',
      tax_rate REAL DEFAULT 0,
      cb_percent REAL DEFAULT 0,
      tags TEXT,
      deleted_at TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (category_id) REFERENCES categories(id)
    );

    CREATE TABLE IF NOT EXISTS addon_groups (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      is_required INTEGER DEFAULT 0,
      min_selection INTEGER DEFAULT 0,
      max_selection INTEGER DEFAULT 1,
      is_active INTEGER DEFAULT 1,
      sort_order INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS addons (
      id TEXT PRIMARY KEY,
      addon_group_id TEXT NOT NULL,
      name TEXT NOT NULL,
      price REAL NOT NULL DEFAULT 0,
      is_active INTEGER DEFAULT 1,
      sort_order INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (addon_group_id) REFERENCES addon_groups(id)
    );

    CREATE TABLE IF NOT EXISTS addon_group_product (
      product_id TEXT NOT NULL,
      addon_group_id TEXT NOT NULL,
      PRIMARY KEY (product_id, addon_group_id)
    );

    CREATE TABLE IF NOT EXISTS kitchen_stations (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      category_ids TEXT,
      printer_ip TEXT,
      printer_port INTEGER DEFAULT 9100,
      printer_name TEXT,
      is_active INTEGER DEFAULT 1,
      sort_order INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS tables (
      id TEXT PRIMARY KEY,
      number TEXT NOT NULL UNIQUE,
      capacity INTEGER DEFAULT 4,
      status TEXT DEFAULT 'available',
      floor TEXT,
      section TEXT,
      position_x REAL,
      position_y REAL,
      kitchen_station_id TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS customers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT,
      phone TEXT,
      country_code TEXT DEFAULT '+91',
      address TEXT,
      loyalty_points INTEGER DEFAULT 0,
      notes TEXT,
      is_active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    -- ── Users (authentication + roles) ──────────────────────────────────
    -- Roles: owner, manager, cashier, waiter, chef
    -- KDS is operated by the chef role.

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT UNIQUE,
      password TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'cashier'
        CHECK (role IN ('owner', 'manager', 'cashier', 'waiter', 'chef')),
      pin TEXT,
      category_ids TEXT,
      is_active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    -- ── Transactional tables ─────────────────────────────────────────────

    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_number TEXT UNIQUE NOT NULL,
      table_id TEXT,
      customer_id TEXT,
      user_id TEXT,
      type TEXT DEFAULT 'takeaway',
      guest_count INTEGER,
      special_instructions TEXT,
      packaging_charge REAL DEFAULT 0,
      delivery_charge REAL DEFAULT 0,
      status TEXT DEFAULT 'pending',
      subtotal REAL DEFAULT 0,
      tax_amount REAL DEFAULT 0,
      tax_breakdown TEXT,
      discount_amount REAL DEFAULT 0,
      discount_type TEXT,
      discount_value REAL,
      discount_reason TEXT,
      round_off REAL DEFAULT 0,
      total REAL DEFAULT 0,
      cooking_started_at TEXT,
      ready_at TEXT,
      served_at TEXT,
      completed_at TEXT,
      cancelled_at TEXT,
      cancellation_reason TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS order_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL,
      product_id TEXT NOT NULL,
      product_name TEXT NOT NULL,
      product_sku TEXT,
      unit_price REAL NOT NULL,
      quantity INTEGER NOT NULL DEFAULT 1,
      subtotal REAL NOT NULL,
      tax_amount REAL DEFAULT 0,
      tax_breakdown TEXT,
      tax_type TEXT,
      discount_amount REAL DEFAULT 0,
      total REAL NOT NULL,
      variant_selection TEXT,
      modifier_selection TEXT,
      addons TEXT,
      special_instructions TEXT,
      status TEXT DEFAULT 'pending',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (order_id) REFERENCES orders(id)
    );

    CREATE TABLE IF NOT EXISTS bills (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      bill_number TEXT UNIQUE NOT NULL,
      order_id INTEGER NOT NULL,
      customer_id TEXT,
      subtotal REAL DEFAULT 0,
      tax_amount REAL DEFAULT 0,
      tax_breakdown TEXT,
      discount_amount REAL DEFAULT 0,
      discount_type TEXT,
      discount_value REAL,
      discount_reason TEXT,
      delivery_charge REAL DEFAULT 0,
      packaging_charge REAL DEFAULT 0,
      round_off REAL DEFAULT 0,
      total REAL DEFAULT 0,
      paid_amount REAL DEFAULT 0,
      balance REAL DEFAULT 0,
      payment_status TEXT DEFAULT 'unpaid',
      payment_details TEXT,
      paid_at TEXT,
      printed_at TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (order_id) REFERENCES orders(id)
    );

    CREATE TABLE IF NOT EXISTS loyalty_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id TEXT NOT NULL,
      bill_id INTEGER,
      type TEXT NOT NULL,
      amount REAL NOT NULL,
      description TEXT,
      expires_at TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    -- ── Config tables ────────────────────────────────────────────────────

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS kds_pairing_tokens (
      id TEXT PRIMARY KEY,
      token TEXT UNIQUE NOT NULL,
      station_id TEXT,
      expires_at TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS printers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      connection_type TEXT NOT NULL CHECK (connection_type IN ('network', 'usb', 'webusb')),
      ip_address TEXT,
      port INTEGER DEFAULT 9100,
      usb_device_path TEXT,
      is_default INTEGER DEFAULT 0,
      paper_width TEXT DEFAULT '80mm',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    -- ── Indexes ──────────────────────────────────────────────────────────

    CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id);
    CREATE INDEX IF NOT EXISTS idx_products_active   ON products(is_active);
    CREATE INDEX IF NOT EXISTS idx_orders_status     ON orders(status);
    CREATE INDEX IF NOT EXISTS idx_orders_created    ON orders(created_at);
    CREATE INDEX IF NOT EXISTS idx_orders_user       ON orders(user_id);
    CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);
    CREATE INDEX IF NOT EXISTS idx_bills_order       ON bills(order_id);
  `);
}

function seedData(): void {
  const insert = (key: string, value: string) =>
    db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)').run(key, value);

  insert('schema_version',      String(SCHEMA_VERSION));
  insert('business_name',       'Shop');
  insert('country',             'IN');
  insert('currency',            'INR');
  insert('currency_symbol',     '₹');
  insert('timezone',            'Asia/Kolkata');
  insert('address',             '');
  insert('phone',               '');
  insert('email',               '');
  insert('tax_registered',      'false');
  insert('gstin',               '');
  insert('state_code',          '');
  insert('tax_scheme',          'regular');
  insert('billing_type',        'postpaid');
  insert('loyalty_expiry_days', '365');
  insert('cloud_server_url',    '');
  insert('cloud_connected',     'false');

  // Default owner account
  const hashedPassword = bcrypt.hashSync('admin123', 10);
  db.prepare(`
    INSERT OR IGNORE INTO users (id, name, email, password, role)
    VALUES (?, ?, ?, ?, ?)
  `).run('user-1', 'Owner', 'admin@flo.local', hashedPassword, 'owner');

  // Default KDS/Chef accounts
  const chefPassword = bcrypt.hashSync('chef123', 10);
  db.prepare(`
    INSERT OR IGNORE INTO users (id, name, email, password, role)
    VALUES (?, ?, ?, ?, ?)
  `).run('user-2', 'Chef', 'chef@flo.local', chefPassword, 'chef');

  db.prepare(`
    INSERT OR IGNORE INTO users (id, name, email, password, role)
    VALUES (?, ?, ?, ?, ?)
  `).run('user-3', 'Kitchen Manager', 'kitchen@flo.local', chefPassword, 'manager');

  // Default printer (will be detected on first run)
  db.prepare(`
    INSERT OR IGNORE INTO printers (id, name, connection_type, paper_width, is_default)
    VALUES (?, ?, ?, ?, ?)
  `).run('printer-1', 'Thermal Printer', 'usb', '80mm', 1);

  // Sample categories
  const cats = [
    ['cat-1', 'Food',      '#FF6B6B', '🍔', 1],
    ['cat-2', 'Beverages', '#4ECDC4', '🥤', 2],
    ['cat-3', 'Desserts',  '#FFE66D', '🍰', 3],
  ];
  for (const [id, name, color, icon, sort] of cats) {
    db.prepare(`
      INSERT OR IGNORE INTO categories (id, name, color, icon, sort_order)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, name, color, icon, sort);
  }

  // Sample products
  const products = [
    ['prod-1', 'cat-1', 'Cheeseburger',     250.00, 1],
    ['prod-2', 'cat-1', 'Veggie Wrap',       180.00, 2],
    ['prod-3', 'cat-1', 'Chicken Sandwich',  220.00, 3],
    ['prod-4', 'cat-1', 'French Fries',       80.00, 4],
    ['prod-5', 'cat-2', 'Cola',               60.00, 1],
    ['prod-6', 'cat-2', 'Fresh Lime Soda',    70.00, 2],
    ['prod-7', 'cat-2', 'Mango Lassi',        90.00, 3],
    ['prod-8', 'cat-2', 'Mineral Water',      30.00, 4],
    ['prod-9', 'cat-3', 'Chocolate Brownie', 120.00, 1],
    ['prod-10','cat-3', 'Ice Cream Scoop',    80.00, 2],
  ];
  for (const [id, catId, name, price, sort] of products) {
    db.prepare(`
      INSERT OR IGNORE INTO products (id, category_id, name, price, sort_order, is_active)
      VALUES (?, ?, ?, ?, ?, 1)
    `).run(id, catId, name, price, sort);
  }

  // Sample tables
  const tables = [
    ['tbl-1', 'T1', 4], ['tbl-2', 'T2', 4],  ['tbl-3', 'T3', 6],
    ['tbl-4', 'T4', 2], ['tbl-5', 'T5', 4],  ['tbl-6', 'T6', 8],
  ];
  for (const [id, number, capacity] of tables) {
    db.prepare(`
      INSERT OR IGNORE INTO tables (id, number, capacity)
      VALUES (?, ?, ?)
    `).run(id, number, capacity);
  }

  console.log('[DB] Seed data loaded');
}

export function generateOrderNumber(): string {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const result = db.prepare(
    "SELECT COUNT(*) + 1 as next FROM orders WHERE date(created_at) = date('now')"
  ).get() as { next: number };
  return `ORD-${date}-${String(result.next).padStart(4, '0')}`;
}

export function generateBillNumber(): string {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const result = db.prepare(
    "SELECT COUNT(*) + 1 as next FROM bills WHERE date(created_at) = date('now')"
  ).get() as { next: number };
  return `INV-${date}-${String(result.next).padStart(4, '0')}`;
}

export function now(): string {
  return new Date().toISOString();
}

/** Parse JSON string fields on order_item rows returned from SQLite.
 *  Stored as JSON.stringify(value) — may be "null", "[...]", "{...}" etc.
 *  Returns actual JS value (array / object / null) so the frontend can map/iterate. */
export function parseItemJson(item: any): any {
  const tryParse = (val: any) => {
    if (typeof val !== 'string') return val;
    try { return JSON.parse(val); } catch { return val; }
  };
  return {
    ...item,
    addons: tryParse(item.addons),
    variant_selection: tryParse(item.variant_selection),
    modifier_selection: tryParse(item.modifier_selection),
    tax_breakdown: tryParse(item.tax_breakdown),
  };
}
