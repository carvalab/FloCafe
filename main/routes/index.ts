import { Express } from 'express';
import { authRoutes } from './auth';
import { categoryRoutes } from './categories';
import { productRoutes } from './products';
import { addonGroupRoutes } from './addon-groups';
import { orderRoutes } from './orders';
import { orderItemRoutes } from './order-items';
import { billRoutes } from './bills';
import { tableRoutes } from './tables';
import { kitchenStationRoutes } from './kitchen-stations';
import { kitchenRoutes } from './kitchen';
import { customerRoutes } from './customers';
import { staffRoutes } from './staff';
import { settingsRoutes } from './settings';
import { reportRoutes } from './reports';
import { kdsRoutes } from './kds';
import { kdsInfoRoutes } from './kds-info';
import { printerRoutes } from './printers';
import { databaseRoutes } from './database';
import { menuCsvRoutes } from './menu-csv';
import { getDatabase, now, parseItemJson } from '../db';
import { cloudSync } from '../services/cloud-sync';

export function registerRoutes(app: Express): void {
  // Auth routes
  app.use('/api/auth', authRoutes);

  // Resource routes
  app.use('/api/categories', categoryRoutes);
  app.use('/api/products', productRoutes);
  app.use('/api/addon-groups', addonGroupRoutes);
  app.use('/api/orders', orderRoutes);
  app.use('/api/order-items', orderItemRoutes);
  app.use('/api/kitchen', kitchenRoutes);
  app.use('/api/bills', billRoutes);
  app.use('/api/tables', tableRoutes);
  app.use('/api/kitchen-stations', kitchenStationRoutes);
  app.use('/api/customers', customerRoutes);
  app.use('/api/staff', staffRoutes);   // users with POS roles
  app.use('/api/users', staffRoutes);   // same router, dual-mounted
  app.use('/api/settings', settingsRoutes);
  app.use('/api/reports', reportRoutes);
  app.use('/api/kds', kdsRoutes);
  app.use('/api/kds-info', kdsInfoRoutes);
  app.use('/api/printers', printerRoutes);
  app.use('/api/db', databaseRoutes);
  app.use('/api/menu-csv', menuCsvRoutes);

  // Tax preview
  app.post('/api/tax/preview', async (req, res) => {
    const { calculateTaxPreview } = await import('../services/tax');
    calculateTaxPreview(req, res);
  });

  // Mobile pairing code — simple stub (rotates daily)
  app.get('/api/mobile/pairing-code', (req, res) => {
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    res.json({
      pairing_code: today,
      rotated_at: new Date().toISOString(),
    });
  });

  // Legacy/flat customer search endpoint (frontend uses this)
  app.get('/api/customers-search', (req, res) => {
    try {
      const { q } = req.query;
      if (!q || String(q).length < 2) {
        return res.json([]);
      }

      const db = getDatabase();
      const searchTerm = `%${q}%`;

      const customers = db.prepare(`
        SELECT * FROM customers
        WHERE phone LIKE ? OR name LIKE ? OR email LIKE ?
        ORDER BY name LIMIT 20
      `).all(searchTerm, searchTerm, searchTerm);

      res.json(customers);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // CRM lookup endpoint (frontend uses this)
  app.get('/api/crm/lookup', (req, res) => {
    try {
      const { phone, country_code } = req.query;
      if (!phone) {
        return res.status(400).json({ error: 'Phone number required' });
      }

      const db = getDatabase();
      const customer = db.prepare('SELECT * FROM customers WHERE phone = ?').get(phone);

      if (customer) {
        res.json({ found: true, customer });
      } else {
        res.json({ found: false, customer: null });
      }
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Soft-delete order item (frontend calls this)
  app.patch('/api/orders/:orderId/items/:itemId/cancel', (req, res) => {
    try {
      const { orderId, itemId } = req.params;

      // Verify JWT token and check role
      const authHeader = req.headers.authorization;
      if (!authHeader?.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Authentication required' });
      }
      const jwt = require('jsonwebtoken');
      const { getJWTSecret } = require('./auth');
      const decoded = jwt.verify(authHeader.split(' ')[1], getJWTSecret()) as { role?: string };
      const userRole = decoded.role;
      if (!userRole || !['owner', 'manager'].includes(userRole)) {
        return res.status(403).json({ error: 'Only owner or manager can cancel items' });
      }

      const db = getDatabase();
      const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId) as any;
      if (!order) {
        return res.status(404).json({ error: 'Order not found' });
      }

      const item = db.prepare('SELECT * FROM order_items WHERE id = ? AND order_id = ?').get(itemId, orderId) as any;
      if (!item) {
        return res.status(404).json({ error: 'Item not found in this order' });
      }

      // Soft delete - mark as cancelled
      db.prepare("UPDATE order_items SET status = 'cancelled', updated_at = ? WHERE id = ?")
        .run(now(), itemId);

      // Recalculate order totals excluding cancelled items
      const activeItems = db.prepare("SELECT * FROM order_items WHERE order_id = ? AND status != 'cancelled'")
        .all(orderId) as any[];
      let subtotal = 0;
      let totalTax = 0;
      for (const i of activeItems) {
        subtotal += i.subtotal || 0;
        totalTax += i.tax_amount || 0;
      }
      const preRoundTotal = subtotal + totalTax + (order.packaging_charge || 0);
      const roundOff = Math.round(preRoundTotal) - preRoundTotal;
      const total = Math.round(preRoundTotal) + roundOff;

      db.prepare(`
        UPDATE orders SET subtotal = ?, tax_amount = ?, total = ?, round_off = ?, updated_at = ? WHERE id = ?
      `).run(subtotal, totalTax, total, roundOff, now(), orderId);

      const updatedOrder = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId) as any;
      const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(orderId).map(parseItemJson);
      cloudSync.recordOrderChanged(orderId, 'order.item_cancelled');

      res.json({ order: { ...updatedOrder, items } });
    } catch (error: any) {
      console.error('[Orders] Cancel item error:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Restore cancelled order item (frontend calls this)
  app.patch('/api/orders/:orderId/items/:itemId/restore', (req, res) => {
    try {
      const { orderId, itemId } = req.params;

      // Verify JWT token and check role
      const authHeader = req.headers.authorization;
      if (!authHeader?.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Authentication required' });
      }
      const jwt = require('jsonwebtoken');
      const { getJWTSecret } = require('./auth');
      const decoded = jwt.verify(authHeader.split(' ')[1], getJWTSecret()) as { role?: string };
      const userRole = decoded.role;
      if (!userRole || !['owner', 'manager'].includes(userRole)) {
        return res.status(403).json({ error: 'Only owner or manager can restore items' });
      }

      const db = getDatabase();
      const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId) as any;
      if (!order) {
        return res.status(404).json({ error: 'Order not found' });
      }

      const item = db.prepare('SELECT * FROM order_items WHERE id = ? AND order_id = ?').get(itemId, orderId) as any;
      if (!item) {
        return res.status(404).json({ error: 'Item not found in this order' });
      }

      // Restore - mark as pending
      db.prepare("UPDATE order_items SET status = 'pending', updated_at = ? WHERE id = ?")
        .run(now(), itemId);

      // Recalculate order totals
      const activeItems = db.prepare("SELECT * FROM order_items WHERE order_id = ? AND status != 'cancelled'")
        .all(orderId) as any[];
      let subtotal = 0;
      let totalTax = 0;
      for (const i of activeItems) {
        subtotal += i.subtotal || 0;
        totalTax += i.tax_amount || 0;
      }
      const preRoundTotal = subtotal + totalTax + (order.packaging_charge || 0);
      const roundOff = Math.round(preRoundTotal) - preRoundTotal;
      const total = Math.round(preRoundTotal) + roundOff;

      db.prepare(`
        UPDATE orders SET subtotal = ?, tax_amount = ?, total = ?, round_off = ?, updated_at = ? WHERE id = ?
      `).run(subtotal, totalTax, total, roundOff, now(), orderId);

      const updatedOrder = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId) as any;
      const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(orderId).map(parseItemJson);
      cloudSync.recordOrderChanged(orderId, 'order.item_restored');

      res.json({ order: { ...updatedOrder, items } });
    } catch (error: any) {
      console.error('[Orders] Restore item error:', error);
      res.status(500).json({ error: error.message });
    }
  });
}
