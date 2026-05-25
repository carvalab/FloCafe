/**
 * Cloud sync service — bridges FloCafe POS with:
 *   FloAdmin  (soflo.codify.tech)   — bill reporting
 *   OrderFlow (reportingserver.codify.tech) — online order ingestion
 *
 * Call cloudSync.start() once after the DB is ready.
 * Call cloudSync.stop() on app shutdown.
 * Call cloudSync.pushBill(bill) after every paid bill.
 */

import { getDatabase, now } from '../db';
import log from 'electron-log';

const FLOADMIN_URL = 'https://soflo.codify.tech/api';
const ORDERFLOW_URL = 'https://reportingserver.codify.tech/api';
const POLL_INTERVAL_MS = 5_000;
const HEARTBEAT_INTERVAL_MS = 5 * 60_000;

type CloudSettings = {
  api_key: string;
  store_id: string;
  sync_enabled: boolean;
  orders_enabled: boolean;
};

class CloudSyncService {
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private settings: CloudSettings | null = null;
  private onOrderReceived: ((order: Record<string, unknown>) => void) | null = null;

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  start(onOrderReceived?: (order: Record<string, unknown>) => void) {
    this.onOrderReceived = onOrderReceived ?? null;
    this.reload();
  }

  reload() {
    this.stop();
    const cfg = this.loadSettings();
    if (!cfg) return;
    this.settings = cfg;

    if (cfg.sync_enabled) {
      this.sendHeartbeat();
      this.heartbeatTimer = setInterval(() => this.sendHeartbeat(), HEARTBEAT_INTERVAL_MS);
    }
    if (cfg.orders_enabled) {
      this.pollTimer = setInterval(() => this.pollOrders(), POLL_INTERVAL_MS);
    }

    log.info('[CloudSync] started — sync:', cfg.sync_enabled, '| orders:', cfg.orders_enabled);
  }

  stop() {
    if (this.pollTimer) { clearInterval(this.pollTimer); this.pollTimer = null; }
    if (this.heartbeatTimer) { clearInterval(this.heartbeatTimer); this.heartbeatTimer = null; }
  }

  // ── Push bill to FloAdmin ──────────────────────────────────────────────────

  async pushBill(bill: Record<string, unknown>) {
    const cfg = this.settings;
    if (!cfg?.sync_enabled || !cfg.api_key) return;

    try {
      const res = await fetch(`${FLOADMIN_URL}/sync/bill`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Api-Key': cfg.api_key },
        body: JSON.stringify(bill),
        signal: AbortSignal.timeout(8000),
      });
      if (res.ok) {
        this.markLastSync();
        log.debug('[CloudSync] bill pushed', bill.pos_bill_id ?? '');
      } else {
        log.warn('[CloudSync] bill push failed', res.status);
      }
    } catch (err) {
      log.warn('[CloudSync] bill push error', (err as Error).message);
    }
  }

  // ── Poll OrderFlow for pending online orders ───────────────────────────────

  private async pollOrders() {
    const cfg = this.settings;
    if (!cfg?.orders_enabled || !cfg.api_key || !cfg.store_id) return;

    try {
      const res = await fetch(`${ORDERFLOW_URL}/orders/pending/${cfg.store_id}`, {
        headers: { 'X-Api-Key': cfg.api_key },
        signal: AbortSignal.timeout(6000),
      });
      if (!res.ok) return;

      const data = await res.json() as { orders: Record<string, unknown>[] };
      if (!data.orders?.length) return;

      for (const order of data.orders) {
        await this.ingestOnlineOrder(order);
        await this.acknowledgeOrder(order.id as string);
      }
    } catch {
      // silent — network may be down
    }
  }

  private async ingestOnlineOrder(order: Record<string, unknown>) {
    try {
      const db = getDatabase();
      const { v4: uuidv4 } = await import('uuid');

      // Build order in local DB
      const orderId = uuidv4();
      const items = order.items as Array<{
        name: string; qty: number; unit_price: number; total: number; addons?: string[]; instructions?: string;
      }>;

      db.prepare(`
        INSERT INTO orders (id, order_number, status, order_type, source_platform,
          customer_name, customer_phone, delivery_address,
          subtotal, tax_amount, total, notes, created_at, updated_at)
        VALUES (?, ?, 'pending', ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)
      `).run(
        orderId,
        `ONL-${order.external_ref ?? order.id}`,
        (order.order_type as string) ?? 'delivery',
        (order.platform as string) ?? 'online',
        (order.customer_name as string) ?? null,
        (order.customer_phone as string) ?? null,
        (order.customer_address as string) ?? null,
        Number(order.subtotal ?? 0),
        Number(order.total ?? 0),
        (order.special_instructions as string) ?? null,
        now(), now(),
      );

      // Insert order items
      for (const item of items) {
        db.prepare(`
          INSERT INTO order_items (id, order_id, product_name, quantity, unit_price, subtotal, addons, notes, status, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
        `).run(
          uuidv4(), orderId,
          item.name, item.qty, item.unit_price, item.total,
          item.addons?.length ? JSON.stringify(item.addons) : null,
          item.instructions ?? null,
          now(), now(),
        );
      }

      log.info('[CloudSync] online order ingested', order.external_ref ?? order.id);

      // Notify frontend via the order receiver callback
      if (this.onOrderReceived) this.onOrderReceived({ ...order, local_order_id: orderId });
    } catch (err) {
      log.error('[CloudSync] ingest error', (err as Error).message);
    }
  }

  private async acknowledgeOrder(orderId: string) {
    const cfg = this.settings;
    if (!cfg?.api_key) return;
    try {
      await fetch(`${ORDERFLOW_URL}/orders/${orderId}/acknowledge`, {
        method: 'POST',
        headers: { 'X-Api-Key': cfg.api_key, 'Content-Type': 'application/json' },
        body: '{}',
        signal: AbortSignal.timeout(5000),
      });
    } catch { /* best-effort */ }
  }

  async sendOrderStatus(orderflowOrderId: string, status: string, note?: string) {
    const cfg = this.settings;
    if (!cfg?.api_key) return;
    try {
      await fetch(`${ORDERFLOW_URL}/orders/${orderflowOrderId}/status`, {
        method: 'POST',
        headers: { 'X-Api-Key': cfg.api_key, 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, note }),
        signal: AbortSignal.timeout(5000),
      });
    } catch { /* best-effort */ }
  }

  // ── Heartbeat ──────────────────────────────────────────────────────────────

  private async sendHeartbeat() {
    const cfg = this.settings;
    if (!cfg?.api_key) return;
    try {
      await fetch(`${FLOADMIN_URL}/sync/heartbeat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Api-Key': cfg.api_key },
        body: JSON.stringify({ pos_version: require('../../package.json').version }),
        signal: AbortSignal.timeout(5000),
      });
    } catch { /* ignore */ }
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private loadSettings(): CloudSettings | null {
    try {
      const db = getDatabase();
      const rows = db.prepare('SELECT key, value FROM settings WHERE key LIKE ?').all('cloud_%') as { key: string; value: string }[];
      const s: Record<string, string> = {};
      for (const r of rows) s[r.key] = r.value;

      const api_key = s.cloud_api_key;
      const store_id = s.cloud_store_id;
      if (!api_key) return null;

      return {
        api_key,
        store_id: store_id ?? '',
        sync_enabled: s.cloud_sync_enabled === '1',
        orders_enabled: s.cloud_orders_enabled === '1',
      };
    } catch {
      return null;
    }
  }

  private markLastSync() {
    try {
      const db = getDatabase();
      db.prepare(`INSERT INTO settings (key, value, updated_at) VALUES ('cloud_last_sync', ?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`)
        .run(new Date().toISOString(), now());
    } catch { /* ignore */ }
  }
}

export const cloudSync = new CloudSyncService();
