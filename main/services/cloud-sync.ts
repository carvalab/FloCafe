/**
 * Outbound-only cloud bridge for FloCafe POS.
 *
 * The POS never opens a public listener. It registers with Blue over HTTPS,
 * pushes local events to an outbox endpoint, and polls a signed command queue
 * for whitelisted read-only requests such as reports and live orders.
 */

import * as crypto from 'crypto';
import * as os from 'os';
import log from 'electron-log';
import { getDatabase, now, parseItemJson, ensureCloudIdentity } from '../db';

export const DEFAULT_CLOUD_SERVER_URL = 'https://blue.flopos.com/';

const HEARTBEAT_INTERVAL_MS = 5 * 60_000;
const OUTBOX_INTERVAL_MS = 15_000;
const COMMAND_POLL_INTERVAL_MS = 10_000;
const REQUEST_TIMEOUT_MS = 8_000;
const MAX_COMMAND_RANGE_DAYS = 370;

type CloudSettings = {
  server_url: string;
  api_key: string;
  store_id: string;
  pos_id: string;
  pos_hash: string;
  sync_enabled: boolean;
  orders_enabled: boolean;
  reports_enabled: boolean;
  command_polling_enabled: boolean;
};

type CloudCommand = {
  id: string;
  type: string;
  payload?: Record<string, unknown>;
};

type OutboxRow = {
  id: string;
  event_type: string;
  entity_type: string | null;
  entity_id: string | null;
  payload: string;
  attempt_count: number;
};

type DateRange = {
  from: string;
  to: string;
};

function sha256Hex(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function hmacHex(secret: string, value: string): string {
  return crypto.createHmac('sha256', secret).update(value).digest('hex');
}

function maskSecret(value: string | null | undefined): string | null {
  if (!value) return null;
  return `****${value.slice(-4)}`;
}

function isLocalDevUrl(url: URL): boolean {
  return ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
}

export function normalizeCloudServerUrl(raw?: string | null): string {
  const url = new URL(raw && raw.trim() ? raw.trim() : DEFAULT_CLOUD_SERVER_URL);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLocalDevUrl(url))) {
    throw new Error('Cloud server URL must use HTTPS');
  }
  url.hash = '';
  url.search = '';
  url.pathname = url.pathname.replace(/\/+$/g, '');
  return url.toString().replace(/\/+$/g, '');
}

function apiPath(pathname: string): string {
  return pathname.startsWith('/api/') ? pathname : `/api/${pathname.replace(/^\/+/, '')}`;
}

function endpoint(serverUrl: string, pathname: string): URL {
  const base = new URL(serverUrl);
  const basePath = base.pathname.replace(/\/+$/g, '');
  const nextPath = apiPath(pathname);
  const adjustedPath = basePath.endsWith('/api') && nextPath.startsWith('/api/')
    ? nextPath.slice('/api'.length)
    : nextPath;
  base.pathname = `${basePath}${adjustedPath}`.replace(/\/{2,}/g, '/');
  return base;
}

function parseIsoDate(value: unknown, fallback: Date): Date {
  if (typeof value !== 'string') return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;
  return date;
}

function dateRange(payload?: Record<string, unknown>): DateRange {
  const nowDate = new Date();
  const defaultFrom = new Date(nowDate);
  defaultFrom.setDate(defaultFrom.getDate() - 30);

  const from = parseIsoDate(payload?.from, defaultFrom);
  const to = parseIsoDate(payload?.to, nowDate);
  const days = Math.abs(to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000);
  if (days > MAX_COMMAND_RANGE_DAYS) {
    throw new Error(`Report range cannot exceed ${MAX_COMMAND_RANGE_DAYS} days`);
  }

  return {
    from: from.toISOString(),
    to: to.toISOString(),
  };
}

function safeJsonParse(value: string | null | undefined): unknown {
  if (!value) return null;
  try { return JSON.parse(value); } catch { return value; }
}

class CloudSyncService {
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private outboxTimer: ReturnType<typeof setInterval> | null = null;
  private commandTimer: ReturnType<typeof setInterval> | null = null;
  private settings: CloudSettings | null = null;
  private flushing = false;
  private pollingCommands = false;

  start() {
    ensureCloudIdentity();
    this.reload();
  }

  reload() {
    this.stop();
    const cfg = this.loadSettings();
    this.settings = cfg;
    if (!cfg) return;

    if (cfg.sync_enabled && cfg.api_key) {
      void this.sendHeartbeat();
      void this.flushOutbox();
      this.heartbeatTimer = setInterval(() => void this.sendHeartbeat(), HEARTBEAT_INTERVAL_MS);
      this.outboxTimer = setInterval(() => void this.flushOutbox(), OUTBOX_INTERVAL_MS);
    }

    if (cfg.command_polling_enabled && cfg.api_key) {
      void this.pollCommands();
      this.commandTimer = setInterval(() => void this.pollCommands(), COMMAND_POLL_INTERVAL_MS);
    }

    log.info('[CloudSync] started', {
      server: cfg.server_url,
      sync: cfg.sync_enabled,
      commands: cfg.command_polling_enabled,
      registered: Boolean(cfg.api_key),
    });
  }

  stop() {
    if (this.heartbeatTimer) { clearInterval(this.heartbeatTimer); this.heartbeatTimer = null; }
    if (this.outboxTimer) { clearInterval(this.outboxTimer); this.outboxTimer = null; }
    if (this.commandTimer) { clearInterval(this.commandTimer); this.commandTimer = null; }
  }

  getStatus() {
    const db = getDatabase();
    const s = this.readSettings(db);
    ensureCloudIdentity();
    const refreshed = this.readSettings(db);
    return {
      cloud_server_url: refreshed.cloud_server_url || DEFAULT_CLOUD_SERVER_URL,
      cloud_pos_hash: refreshed.cloud_pos_hash || null,
      cloud_pos_id: refreshed.cloud_pos_id || null,
      cloud_store_id: refreshed.cloud_store_id || null,
      cloud_api_key: maskSecret(refreshed.cloud_api_key),
      cloud_sync_enabled: refreshed.cloud_sync_enabled === '1',
      cloud_orders_enabled: refreshed.cloud_orders_enabled === '1',
      cloud_reports_enabled: refreshed.cloud_reports_enabled === '1',
      cloud_command_polling_enabled: refreshed.cloud_command_polling_enabled === '1',
      cloud_registration_status: refreshed.cloud_registration_status || 'unregistered',
      cloud_connected: refreshed.cloud_connected === 'true',
      cloud_last_sync: refreshed.cloud_last_sync || null,
      cloud_last_heartbeat: refreshed.cloud_last_heartbeat || null,
      cloud_last_error: refreshed.cloud_last_error || null,
      outbox_pending: this.countOutbox('pending'),
      outbox_failed: this.countOutbox('failed'),
      loaded: Boolean(s),
    };
  }

  async register(): Promise<Record<string, unknown>> {
    const db = getDatabase();
    const settings = this.readSettings(db);
    const { posHash, deviceSecret } = ensureCloudIdentity();
    const serverUrl = normalizeCloudServerUrl(settings.cloud_server_url || DEFAULT_CLOUD_SERVER_URL);
    const body = {
      pos_hash: posHash,
      device_secret_hash: sha256Hex(deviceSecret),
      device_name: os.hostname(),
      platform: process.platform,
      arch: process.arch,
      app_version: require('../../package.json').version,
      business: {
        name: settings.business_name || '',
        phone: settings.business_phone || settings.phone || '',
        country: settings.country || 'IN',
        timezone: settings.timezone || 'Asia/Kolkata',
      },
      requested_at: new Date().toISOString(),
    };

    try {
      const res = await fetch(endpoint(serverUrl, '/api/pos/register'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Flo-POS-Hash': posHash,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      const data = await res.json().catch(() => ({})) as Record<string, unknown>;
      if (!res.ok) {
        throw new Error(String(data.error || `Registration failed (${res.status})`));
      }

      const apiKey = typeof data.api_key === 'string' ? data.api_key : settings.cloud_api_key;
      if (!apiKey) throw new Error('Registration response did not include api_key');

      this.upsertSettings({
        cloud_server_url: serverUrl,
        cloud_api_key: apiKey,
        cloud_pos_id: typeof data.pos_id === 'string' ? data.pos_id : settings.cloud_pos_id,
        cloud_store_id: typeof data.store_id === 'string' ? data.store_id : settings.cloud_store_id,
        cloud_registration_status: 'registered',
        cloud_connected: 'true',
        cloud_last_error: '',
        cloud_last_heartbeat: new Date().toISOString(),
      });
      this.reload();
      return this.getStatus();
    } catch (err) {
      const message = (err as Error).message;
      this.upsertSettings({
        cloud_registration_status: 'registration_failed',
        cloud_connected: 'false',
        cloud_last_error: message,
      });
      throw err;
    }
  }

  async testConnection(): Promise<Record<string, unknown>> {
    const res = await this.signedFetch('/api/pos/connection-test', { method: 'POST', body: '{}' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`Cloud test failed (${res.status})`);
    this.upsertSettings({
      cloud_connected: 'true',
      cloud_last_error: '',
      cloud_last_heartbeat: new Date().toISOString(),
    });
    return { ok: true, data, status: this.getStatus() };
  }

  pushBill(bill: Record<string, unknown>) {
    this.enqueueEvent('bill.paid', 'bill', String(bill.id ?? bill.pos_bill_id ?? ''), bill);
  }

  recordBillPaid(billId: number | string) {
    try {
      const snapshot = this.buildBillSnapshot(billId);
      if (snapshot) this.enqueueEvent('bill.paid', 'bill', String(billId), snapshot);
    } catch (err) {
      log.warn('[CloudSync] bill snapshot failed', (err as Error).message);
    }
  }

  recordOrderChanged(orderId: number | string, eventType = 'order.updated') {
    try {
      const snapshot = this.buildOrderSnapshot(orderId);
      if (snapshot) this.enqueueEvent(eventType, 'order', String(orderId), snapshot);
    } catch (err) {
      log.warn('[CloudSync] order snapshot failed', (err as Error).message);
    }
  }

  sendOrderStatus(orderflowOrderId: string, status: string, note?: string) {
    this.enqueueEvent('order.status', 'order', orderflowOrderId, { orderflow_order_id: orderflowOrderId, status, note });
  }

  private async sendHeartbeat() {
    const cfg = this.settings;
    if (!cfg?.sync_enabled || !cfg.api_key) return;
    try {
      const db = getDatabase();
      const activeOrders = db.prepare(`
        SELECT COUNT(*) as count FROM orders
        WHERE status IN ('pending', 'preparing', 'ready', 'served')
      `).get() as { count: number };
      const todaySales = db.prepare(`
        SELECT COALESCE(SUM(total), 0) as total, COUNT(*) as count
        FROM bills
        WHERE payment_status = 'paid' AND date(paid_at) = date('now')
      `).get() as { total: number; count: number };
      const body = {
        pos_hash: cfg.pos_hash,
        pos_id: cfg.pos_id || null,
        app_version: require('../../package.json').version,
        device_name: os.hostname(),
        active_orders: activeOrders.count,
        today_sales: todaySales.total,
        today_bills: todaySales.count,
        sent_at: new Date().toISOString(),
      };
      const res = await this.signedFetch('/api/pos/heartbeat', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`heartbeat failed (${res.status})`);
      this.upsertSettings({
        cloud_connected: 'true',
        cloud_last_error: '',
        cloud_last_heartbeat: new Date().toISOString(),
      });
    } catch (err) {
      this.markError((err as Error).message);
    }
  }

  private enqueueEvent(eventType: string, entityType: string, entityId: string, payload: unknown) {
    const cfg = this.loadSettings();
    if (!cfg?.sync_enabled) return;
    const db = getDatabase();
    const id = crypto.randomUUID();
    db.prepare(`
      INSERT INTO cloud_sync_outbox
        (id, event_type, entity_type, entity_id, payload, status, attempt_count, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'pending', 0, ?, ?)
    `).run(id, eventType, entityType, entityId || null, JSON.stringify(payload), now(), now());
    void this.flushOutbox();
  }

  private async flushOutbox() {
    const cfg = this.settings ?? this.loadSettings();
    if (!cfg?.sync_enabled || !cfg.api_key || this.flushing) return;
    this.flushing = true;
    try {
      const db = getDatabase();
      const rows = db.prepare(`
        SELECT * FROM cloud_sync_outbox
        WHERE status IN ('pending', 'failed')
          AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
        ORDER BY created_at ASC
        LIMIT 50
      `).all(now()) as OutboxRow[];
      if (rows.length === 0) return;

      const events = rows.map((row) => ({
        id: row.id,
        type: row.event_type,
        entity_type: row.entity_type,
        entity_id: row.entity_id,
        payload: safeJsonParse(row.payload),
      }));

      db.prepare(`
        UPDATE cloud_sync_outbox SET status = 'sending', updated_at = ? WHERE id = ?
      `);

      for (const row of rows) {
        db.prepare(`UPDATE cloud_sync_outbox SET status = 'sending', updated_at = ? WHERE id = ?`).run(now(), row.id);
      }

      const res = await this.signedFetch('/api/pos/events', {
        method: 'POST',
        body: JSON.stringify({
          pos_hash: cfg.pos_hash,
          events,
          sent_at: new Date().toISOString(),
        }),
      });
      if (!res.ok) throw new Error(`event push failed (${res.status})`);

      const markDelivered = db.prepare(`
        UPDATE cloud_sync_outbox
        SET status = 'delivered', delivered_at = ?, updated_at = ?, last_error = NULL
        WHERE id = ?
      `);
      const deliveredAt = now();
      for (const row of rows) markDelivered.run(deliveredAt, deliveredAt, row.id);
      this.upsertSettings({
        cloud_connected: 'true',
        cloud_last_sync: new Date().toISOString(),
        cloud_last_error: '',
      });
    } catch (err) {
      this.failSendingRows((err as Error).message);
    } finally {
      this.flushing = false;
    }
  }

  private failSendingRows(message: string) {
    const db = getDatabase();
    const rows = db.prepare(`
      SELECT id, attempt_count FROM cloud_sync_outbox WHERE status = 'sending'
    `).all() as { id: string; attempt_count: number }[];
    const stmt = db.prepare(`
      UPDATE cloud_sync_outbox
      SET status = 'failed', attempt_count = ?, next_attempt_at = ?, last_error = ?, updated_at = ?
      WHERE id = ?
    `);
    for (const row of rows) {
      const attempts = row.attempt_count + 1;
      const delayMs = Math.min(30 * 60_000, Math.pow(2, Math.min(attempts, 8)) * 1000);
      stmt.run(attempts, new Date(Date.now() + delayMs).toISOString(), message, now(), row.id);
    }
    this.markError(message);
  }

  private async pollCommands() {
    const cfg = this.settings;
    if (!cfg?.command_polling_enabled || !cfg.api_key || this.pollingCommands) return;
    this.pollingCommands = true;
    try {
      const res = await this.signedFetch('/api/pos/commands?limit=5', { method: 'GET' });
      if (!res.ok) throw new Error(`command poll failed (${res.status})`);
      const data = await res.json().catch(() => ({})) as { commands?: CloudCommand[] };
      const commands = Array.isArray(data.commands) ? data.commands : [];
      for (const command of commands) {
        await this.executeCommand(command);
      }
    } catch (err) {
      this.markError((err as Error).message);
    } finally {
      this.pollingCommands = false;
    }
  }

  private async executeCommand(command: CloudCommand) {
    let body: Record<string, unknown>;
    try {
      const result = this.runCommand(command);
      body = { ok: true, result, completed_at: new Date().toISOString() };
    } catch (err) {
      body = { ok: false, error: (err as Error).message, completed_at: new Date().toISOString() };
    }

    const res = await this.signedFetch(`/api/pos/commands/${encodeURIComponent(command.id)}/result`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`command result failed (${res.status})`);
  }

  private runCommand(command: CloudCommand): unknown {
    switch (command.type) {
      case 'health.get':
        return this.healthPayload();
      case 'orders.live':
        return this.liveOrders(command.payload);
      case 'orders.get':
        return this.getOrder(command.payload);
      case 'report.sales':
        return this.salesReport(command.payload);
      default:
        throw new Error(`Unsupported command type: ${command.type}`);
    }
  }

  private healthPayload() {
    const db = getDatabase();
    const schema = db.pragma('user_version', { simple: true }) as number;
    return {
      pos_hash: this.settings?.pos_hash,
      schema_version: schema,
      app_version: require('../../package.json').version,
      device_name: os.hostname(),
      time: new Date().toISOString(),
    };
  }

  private liveOrders(payload?: Record<string, unknown>) {
    const db = getDatabase();
    const rawStatuses = Array.isArray(payload?.statuses) ? payload?.statuses : ['pending', 'preparing', 'ready', 'served'];
    const statuses = rawStatuses
      .map((status) => String(status))
      .filter((status) => ['pending', 'preparing', 'ready', 'served'].includes(status));
    if (statuses.length === 0) return { orders: [] };

    const placeholders = statuses.map(() => '?').join(',');
    const orders = db.prepare(`
      SELECT * FROM orders
      WHERE status IN (${placeholders})
      ORDER BY created_at ASC
      LIMIT 200
    `).all(...statuses) as any[];

    return { orders: orders.map((order) => this.decorateOrder(order)) };
  }

  private getOrder(payload?: Record<string, unknown>) {
    const id = payload?.order_id;
    if (!id) throw new Error('order_id is required');
    const order = this.buildOrderSnapshot(String(id));
    if (!order) throw new Error('Order not found');
    return { order };
  }

  private salesReport(payload?: Record<string, unknown>) {
    const db = getDatabase();
    const range = dateRange(payload);
    const totals = db.prepare(`
      SELECT
        COUNT(*) as bill_count,
        COALESCE(SUM(total), 0) as gross_sales,
        COALESCE(SUM(subtotal), 0) as subtotal,
        COALESCE(SUM(tax_amount), 0) as tax_amount,
        COALESCE(SUM(discount_amount), 0) as discount_amount,
        COALESCE(SUM(paid_amount), 0) as paid_amount
      FROM bills
      WHERE payment_status = 'paid'
        AND COALESCE(paid_at, created_at) >= ?
        AND COALESCE(paid_at, created_at) <= ?
    `).get(range.from, range.to);

    const byDay = db.prepare(`
      SELECT date(COALESCE(paid_at, created_at)) as date,
        COUNT(*) as bill_count,
        COALESCE(SUM(total), 0) as gross_sales
      FROM bills
      WHERE payment_status = 'paid'
        AND COALESCE(paid_at, created_at) >= ?
        AND COALESCE(paid_at, created_at) <= ?
      GROUP BY date(COALESCE(paid_at, created_at))
      ORDER BY date ASC
    `).all(range.from, range.to);

    const topItems = db.prepare(`
      SELECT oi.product_id, oi.product_name,
        COALESCE(SUM(oi.quantity), 0) as quantity,
        COALESCE(SUM(oi.total), 0) as total
      FROM order_items oi
      JOIN orders o ON o.id = oi.order_id
      JOIN bills b ON b.order_id = o.id
      WHERE b.payment_status = 'paid'
        AND COALESCE(b.paid_at, b.created_at) >= ?
        AND COALESCE(b.paid_at, b.created_at) <= ?
      GROUP BY oi.product_id, oi.product_name
      ORDER BY total DESC
      LIMIT 20
    `).all(range.from, range.to);

    return { range, totals, by_day: byDay, top_items: topItems };
  }

  private buildOrderSnapshot(orderId: number | string) {
    const db = getDatabase();
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId) as any;
    if (!order) return null;
    return this.decorateOrder(order);
  }

  private buildBillSnapshot(billId: number | string) {
    const db = getDatabase();
    const bill = db.prepare('SELECT * FROM bills WHERE id = ?').get(billId) as any;
    if (!bill) return null;
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(bill.order_id) as any;
    const customer = bill.customer_id ? db.prepare('SELECT * FROM customers WHERE id = ?').get(bill.customer_id) : null;
    const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(bill.order_id).map(parseItemJson);
    return {
      bill: {
        ...bill,
        payment_details: safeJsonParse(bill.payment_details),
      },
      order: order ? this.decorateOrder(order, items) : null,
      customer,
    };
  }

  private decorateOrder(order: any, itemsOverride?: any[]) {
    const db = getDatabase();
    const items = itemsOverride ?? db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(order.id).map(parseItemJson);
    const tableRow = order.table_id ? db.prepare('SELECT * FROM tables WHERE id = ?').get(order.table_id) as any : null;
    const customer = order.customer_id ? db.prepare('SELECT * FROM customers WHERE id = ?').get(order.customer_id) : null;
    const bill = db.prepare('SELECT * FROM bills WHERE order_id = ?').get(order.id) as any;
    return {
      ...order,
      items,
      table: tableRow ? { ...tableRow, name: tableRow.number } : null,
      customer,
      bill: bill ? { ...bill, payment_details: safeJsonParse(bill.payment_details) } : null,
    };
  }

  private async signedFetch(pathname: string, init: RequestInit): Promise<Response> {
    const cfg = this.settings ?? this.loadSettings();
    if (!cfg?.api_key) throw new Error('Cloud POS is not registered');

    const method = (init.method || 'GET').toUpperCase();
    const url = endpoint(cfg.server_url, pathname);
    const body = typeof init.body === 'string' ? init.body : '';
    const timestamp = new Date().toISOString();
    const nonce = crypto.randomUUID();
    const bodyHash = sha256Hex(body);
    const signedPath = `${url.pathname}${url.search}`;
    const signatureBase = [method, signedPath, timestamp, nonce, bodyHash].join('\n');
    const signature = hmacHex(cfg.api_key, signatureBase);

    return fetch(url, {
      ...init,
      method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${cfg.api_key}`,
        'X-Flo-POS-Hash': cfg.pos_hash,
        'X-Flo-Timestamp': timestamp,
        'X-Flo-Nonce': nonce,
        'X-Flo-Body-SHA256': bodyHash,
        'X-Flo-Signature': `sha256=${signature}`,
        ...(init.headers || {}),
      },
      body: method === 'GET' ? undefined : body,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  }

  private loadSettings(): CloudSettings | null {
    try {
      const db = getDatabase();
      ensureCloudIdentity();
      const s = this.readSettings(db);
      const server_url = normalizeCloudServerUrl(s.cloud_server_url || DEFAULT_CLOUD_SERVER_URL);
      return {
        server_url,
        api_key: s.cloud_api_key || '',
        store_id: s.cloud_store_id || '',
        pos_id: s.cloud_pos_id || '',
        pos_hash: s.cloud_pos_hash || '',
        sync_enabled: s.cloud_sync_enabled === '1',
        orders_enabled: s.cloud_orders_enabled === '1',
        reports_enabled: s.cloud_reports_enabled === '1',
        command_polling_enabled: s.cloud_command_polling_enabled === '1',
      };
    } catch (err) {
      log.warn('[CloudSync] settings unavailable', (err as Error).message);
      return null;
    }
  }

  private readSettings(db: ReturnType<typeof getDatabase>): Record<string, string> {
    const rows = db.prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[];
    const s: Record<string, string> = {};
    for (const row of rows) s[row.key] = row.value;
    return s;
  }

  private upsertSettings(entries: Record<string, string | undefined | null>) {
    const db = getDatabase();
    const stmt = db.prepare(`
      INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `);
    for (const [key, value] of Object.entries(entries)) {
      if (value !== undefined && value !== null) stmt.run(key, value, now());
    }
  }

  private countOutbox(status: string): number {
    try {
      const row = getDatabase().prepare('SELECT COUNT(*) as count FROM cloud_sync_outbox WHERE status = ?')
        .get(status) as { count: number };
      return row.count;
    } catch {
      return 0;
    }
  }

  private markError(message: string) {
    this.upsertSettings({
      cloud_connected: 'false',
      cloud_last_error: message,
    });
    log.warn('[CloudSync]', message);
  }
}

export const cloudSync = new CloudSyncService();
