import { Router, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { getDatabase, now, parseItemJson } from '../db';
import { notifyKdsUpdate } from '../services/kds';
import { getJWTSecret } from './auth';

const router = Router();

/** Decode the Bearer token and return the role, or null if missing/invalid. */
function getRoleFromToken(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) return null;
  try {
    const decoded = jwt.verify(authHeader.split(' ')[1], getJWTSecret()) as { role?: string };
    return decoded.role ?? null;
  } catch {
    return null;
  }
}

// PATCH /api/order-items/:id/status — update a single item's kitchen status
router.patch('/:id/status', (req: Request, res: Response) => {
  try {
    const { status } = req.body;
    const validStatuses = ['pending', 'preparing', 'ready', 'served'];

    if (!status || !validStatuses.includes(status)) {
      return res.status(400).json({ error: `Valid status required: ${validStatuses.join(', ')}` });
    }

    const db = getDatabase();
    const item = db.prepare('SELECT * FROM order_items WHERE id = ?').get(req.params.id) as any;
    if (!item) {
      return res.status(404).json({ error: 'Order item not found' });
    }

    db.prepare('UPDATE order_items SET status = ?, updated_at = ? WHERE id = ?')
      .run(status, now(), req.params.id);

    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(item.order_id) as any;
    const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(item.order_id).map(parseItemJson);
    const tableRow = order.table_id
      ? db.prepare('SELECT * FROM tables WHERE id = ?').get(order.table_id) as any
      : null;
    const table = tableRow ? { ...tableRow, name: tableRow.number } : null;

    notifyKdsUpdate();

    res.json({ order: { ...order, items, table } });
  } catch (error: any) {
    console.error('[OrderItems] Status update error:', error);
    res.status(500).json({ error: error.message });
  }
});

export const orderItemRoutes = router;
