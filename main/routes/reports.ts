import { Router, Request, Response } from 'express';
import { getDatabase, now } from '../db';
import { requireRole } from '../middleware/security';

const router = Router();

router.get('/daily-stats', requireRole('owner', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const today = new Date().toISOString().slice(0, 10);

    const salesToday = db.prepare(`
      SELECT COALESCE(SUM(paid_amount), 0) as sales
      FROM bills WHERE date(created_at) = date(?)
    `).get(today) as { sales: number };

    const runningOrders = db.prepare(`
      SELECT COUNT(*) as count FROM orders WHERE status IN ('pending', 'preparing')
    `).get() as { count: number };

    const pendingOrders = db.prepare(`
      SELECT COUNT(*) as count FROM orders WHERE status = 'pending'
    `).get() as { count: number };

    const tablesOccupied = db.prepare(`
      SELECT COUNT(*) as count FROM tables WHERE status = 'occupied'
    `).get() as { count: number };

    res.json({
      sales: salesToday.sales,
      runningOrders: runningOrders.count,
      pendingOrders: pendingOrders.count,
      tablesOccupied: tablesOccupied.count,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/summary', requireRole('owner', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const date = req.query.date as string || new Date().toISOString().slice(0, 10);

    const ordersToday = db.prepare(`
      SELECT COUNT(*) as count, COALESCE(SUM(total), 0) as total
      FROM orders WHERE date(created_at) = date(?)
    `).get(date) as { count: number; total: number };

    const billsToday = db.prepare(`
      SELECT COUNT(*) as count, COALESCE(SUM(total), 0) as total, COALESCE(SUM(paid_amount), 0) as collected
      FROM bills WHERE date(created_at) = date(?)
    `).get(date) as { count: number; total: number; collected: number };

    const customersToday = db.prepare(`
      SELECT COUNT(*) as count FROM customers WHERE date(created_at) = date(?)
    `).get(date) as { count: number };

    const ordersByStatus = db.prepare(`
      SELECT status, COUNT(*) as count FROM orders WHERE date(created_at) = date(?) GROUP BY status
    `).all(date);

    const topPaymentMethods = db.prepare(`
      SELECT payment_details, COUNT(*) as count, SUM(paid_amount) as total
      FROM bills WHERE payment_status = 'paid' AND date(paid_at) = date(?)
      GROUP BY json_extract(payment_details, '$.method')
    `).all(date);

    res.json({
      summary: {
        date,
        orders: { count: ordersToday.count, total: ordersToday.total },
        bills: { count: billsToday.count, total: billsToday.total, collected: billsToday.collected },
        customers: { new: customersToday.count },
        ordersByStatus,
        topPaymentMethods,
      }
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/sales', requireRole('owner', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const startDate = req.query.start_date as string || new Date().toISOString().slice(0, 10);
    const endDate = req.query.end_date as string || new Date().toISOString().slice(0, 10);

    const dailySales = db.prepare(`
      SELECT date(created_at) as date, COUNT(*) as orders, SUM(total) as sales
      FROM orders
      WHERE date(created_at) BETWEEN date(?) AND date(?)
      GROUP BY date(created_at)
      ORDER BY date
    `).all(startDate, endDate);

    const byPaymentMethod = db.prepare(`
      SELECT json_extract(payment_details, '$.method') as method,
        COUNT(*) as count, SUM(paid_amount) as total
      FROM bills
      WHERE payment_status = 'paid'
        AND date(paid_at) BETWEEN date(?) AND date(?)
      GROUP BY json_extract(payment_details, '$.method')
    `).all(startDate, endDate);

    const byOrderType = db.prepare(`
      SELECT type, COUNT(*) as count, SUM(total) as total
      FROM orders
      WHERE date(created_at) BETWEEN date(?) AND date(?)
      GROUP BY type
    `).all(startDate, endDate);

    res.json({
      sales: {
        startDate,
        endDate,
        dailySales,
        byPaymentMethod,
        byOrderType,
      }
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/topProducts', requireRole('owner', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const startDate = req.query.start_date as string || new Date().toISOString().slice(0, 10);
    const endDate = req.query.end_date as string || new Date().toISOString().slice(0, 10);
    const limit = parseInt(req.query.limit as string) || 10;

    const topProducts = db.prepare(`
      SELECT oi.product_id, oi.product_name,
        SUM(oi.quantity) as total_quantity,
        SUM(oi.subtotal) as total_revenue,
        COUNT(DISTINCT oi.order_id) as order_count
      FROM order_items oi
      JOIN orders o ON oi.order_id = o.id
      WHERE date(o.created_at) BETWEEN date(?) AND date(?)
      GROUP BY oi.product_id
      ORDER BY total_quantity DESC
      LIMIT ?
    `).all(startDate, endDate, limit);

    res.json({ topProducts });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/recentOrders', requireRole('owner', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const limit = parseInt(req.query.limit as string) || 20;

    const recentOrders = db.prepare(`
      SELECT o.*, t.number as table_name, c.name as customer_name
      FROM orders o
      LEFT JOIN tables t ON o.table_id = t.id
      LEFT JOIN customers c ON o.customer_id = c.id
      ORDER BY o.created_at DESC
      LIMIT ?
    `).all(limit);

    const ordersWithItems = recentOrders.map((order: any) => {
      const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(order.id);
      return { ...order, items };
    });

    res.json({ recentOrders: ordersWithItems });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/tables', requireRole('owner', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDatabase();

    const tableStats = db.prepare(`
      SELECT t.*,
        COUNT(DISTINCT o.id) as total_orders,
        COALESCE(SUM(o.total), 0) as total_revenue,
        MAX(o.created_at) as last_order_at
      FROM tables t
      LEFT JOIN orders o ON t.id = o.table_id
      WHERE date(o.created_at) = date('now') OR o.id IS NULL
      GROUP BY t.id
    `).all();

    const tableUtilization = db.prepare(`
      SELECT
        SUM(CASE WHEN status = 'occupied' THEN 1 ELSE 0 END) as occupied,
        SUM(CASE WHEN status = 'available' THEN 1 ELSE 0 END) as available,
        SUM(CASE WHEN status = 'reserved' THEN 1 ELSE 0 END) as reserved,
        SUM(CASE WHEN status = 'cleaning' THEN 1 ELSE 0 END) as cleaning,
        COUNT(*) as total
      FROM tables
    `).get();

    res.json({
      tableStats,
      tableUtilization
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export const reportRoutes = router;
