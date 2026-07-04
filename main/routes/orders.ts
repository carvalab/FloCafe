import { Router, Request, Response } from 'express';
import { getDatabase, generateOrderNumber, now, parseItemJson, withTxn } from '../db';
import { calculateItemTax } from '../services/tax';
import { notifyKdsUpdate } from '../services/kds';
import { cloudSync } from '../services/cloud-sync';
import { validateOrderNotes, validateItemNotes } from './orders-validation';

const router = Router();

function syncCustomerTagCounts(db: any, customerId: string, items: { product_id: string; quantity: number }[]) {
  const row = db.prepare('SELECT tag_counts FROM customers WHERE id = ?').get(customerId) as any;
  if (!row) return;
  let counts: Record<string, number> = {};
  try { counts = row.tag_counts ? JSON.parse(row.tag_counts) : {}; } catch { counts = {}; }
  for (const item of items) {
    const product = db.prepare('SELECT tags FROM products WHERE id = ?').get(item.product_id) as any;
    if (!product?.tags) continue;
    let tags: string[] = [];
    try { tags = JSON.parse(product.tags); } catch { continue; }
    for (const tag of tags) {
      if (tag && typeof tag === 'string') counts[tag] = (counts[tag] || 0) + (item.quantity || 1);
    }
  }
  db.prepare('UPDATE customers SET tag_counts = ?, updated_at = ? WHERE id = ?')
    .run(JSON.stringify(counts), now(), customerId);
}

router.get('/', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    let query = 'SELECT * FROM orders WHERE 1=1';
    const params: any[] = [];

    if (req.query.status) {
      query += ' AND status = ?';
      params.push(req.query.status);
    }
    if (req.query.type) {
      query += ' AND type = ?';
      params.push(req.query.type);
    }
    if (req.query.today && req.query.today !== '0' && req.query.today !== 'false') {
      query += " AND date(created_at) = date('now')";
    }
    if (req.query.table_id) {
      query += ' AND table_id = ?';
      params.push(req.query.table_id);
    }

    query += ' ORDER BY created_at DESC';

    if (req.query.per_page) {
      query += ` LIMIT ${parseInt(req.query.per_page as string)}`;
    }

    const orders = db.prepare(query).all(...params);

    // Load related data
    const ordersWithRelations = orders.map((order: any) => {
      const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(order.id).map(parseItemJson);
      const tableRow = order.table_id ? db.prepare('SELECT * FROM tables WHERE id = ?').get(order.table_id) as any : null;
      const table = tableRow ? { ...tableRow, name: tableRow.number } : null;
      const customer = order.customer_id ? db.prepare('SELECT * FROM customers WHERE id = ?').get(order.customer_id) : null;
      const bill = db.prepare('SELECT * FROM bills WHERE order_id = ?').get(order.id) as any;
      return { ...order, items, table, customer, bill };
    });

    res.json({ orders: ordersWithRelations });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/:id', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(req.params.id).map(parseItemJson);
    const tableRow = (order as any).table_id ? db.prepare('SELECT * FROM tables WHERE id = ?').get((order as any).table_id) as any : null;
    const table = tableRow ? { ...tableRow, name: tableRow.number } : null;
    const customer = (order as any).customer_id ? db.prepare('SELECT * FROM customers WHERE id = ?').get((order as any).customer_id) : null;
    const bill = db.prepare('SELECT * FROM bills WHERE order_id = ?').get(req.params.id);

    res.json({ order: { ...order, items, table, customer, bill } });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/', (req: Request, res: Response) => {
  try {
    const { table_id, customer_id, user_id, type, guest_count, special_instructions, packaging_charge, items } = req.body;

    if (!items || items.length === 0) {
      return res.status(400).json({ error: 'At least one item is required' });
    }

    if (!type || !['dine_in', 'takeaway', 'delivery', 'online'].includes(type)) {
      return res.status(400).json({ error: 'Valid type is required (dine_in, takeaway, delivery, online)' });
    }

    const db = getDatabase();

    try {
      validateOrderNotes(db, special_instructions);
      for (const item of items) {
        validateItemNotes(db, item.special_instructions);
      }
    } catch (err: any) {
      return res.status(400).json({ error: err.message });
    }
    const orderNumber = generateOrderNumber();

    // Get settings for tax calculation
    const settings: Record<string, string> = {};
    db.prepare('SELECT key, value FROM settings').all().forEach((row: any) => {
      settings[row.key] = row.value;
    });

    const tenantInfo = {
      country: settings.country || 'IN',
      business_type: settings.business_type || 'restaurant',
      state_code: settings.state_code || '',
    };

    const { order, orderItems } = withTxn(() => {
      const orderResult = db.prepare(`
        INSERT INTO orders (order_number, table_id, customer_id, user_id, type, guest_count, special_instructions,
          packaging_charge, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
      `).run(orderNumber, table_id || null, customer_id || null, user_id || null, type, guest_count || null,
        special_instructions || null, packaging_charge || 0, now(), now());

      const orderId = orderResult.lastInsertRowid;

      let subtotal = 0;
      let totalTax = 0;
      const allTaxBreakdowns: any[] = [];

      const insertItem = db.prepare(`
        INSERT INTO order_items (order_id, product_id, product_name, product_sku, unit_price, quantity,
          subtotal, tax_amount, tax_breakdown, tax_type, discount_amount, total, variant_selection,
          modifier_selection, addons, special_instructions, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
      `);

      for (const item of items) {
        const product = db.prepare('SELECT * FROM products WHERE id = ?').get(item.product_id) as any;
        if (!product) {
          throw new Error(`Product ${item.product_id} not found`);
        }

        if (product.track_inventory && product.stock_quantity < item.quantity) {
          throw new Error(`Insufficient stock for ${product.name}`);
        }

        const unitPrice = parseFloat(product.price);
        const quantity = item.quantity;
        const itemDiscount = item.discount_amount || 0;

        let itemSubtotal = unitPrice * quantity;
        if (item.addons) {
          for (const addon of item.addons) {
            itemSubtotal += (addon.price || 0) * quantity;
          }
        }
        itemSubtotal = Math.max(0, itemSubtotal - itemDiscount);

        const customer = customer_id ? db.prepare('SELECT * FROM customers WHERE id = ?').get(customer_id) as any : null;
        const taxResult = calculateItemTax(tenantInfo, product, itemSubtotal, customer);

        totalTax += taxResult.tax_amount;
        if (taxResult.tax_breakdown) {
          allTaxBreakdowns.push(taxResult.tax_breakdown);
        }

        const itemTotal = itemSubtotal + taxResult.tax_amount;
        subtotal += itemSubtotal;

        insertItem.run(
          orderId, product.id, product.name, product.sku, unitPrice, quantity,
          itemSubtotal, taxResult.tax_amount, JSON.stringify(taxResult.tax_breakdown),
          product.tax_type, itemDiscount, itemTotal,
          JSON.stringify(item.variant_selection || null),
          JSON.stringify(item.modifier_selection || null),
          JSON.stringify(item.addons || null),
          item.special_instructions || null, now(), now()
        );

        if (product.track_inventory) {
          db.prepare('UPDATE products SET stock_quantity = stock_quantity - ?, updated_at = ? WHERE id = ?')
            .run(quantity, now(), product.id);
        }
      }

      const preRoundTotal = subtotal + totalTax + (packaging_charge || 0);
      const roundOff = Math.round(preRoundTotal) - preRoundTotal;
      const total = Math.round(preRoundTotal) + roundOff;

      db.prepare(`
        UPDATE orders SET subtotal = ?, tax_amount = ?, tax_breakdown = ?, total = ?,
          round_off = ?, updated_at = ? WHERE id = ?
      `).run(subtotal, totalTax, JSON.stringify(allTaxBreakdowns), total, roundOff, now(), orderId);

      if (table_id && type === 'dine_in') {
        db.prepare("UPDATE tables SET status = 'occupied', updated_at = ? WHERE id = ?").run(now(), table_id);
      }

      const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId) as any;
      const orderItems = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(orderId).map(parseItemJson);
      return { order, orderItems };
    });

    notifyKdsUpdate();
    cloudSync.recordOrderChanged(order.id, 'order.created');

    if (customer_id) {
      try {
        syncCustomerTagCounts(db, customer_id, items);
      } catch (err) {
        console.error('[Orders] Tag sync failed:', err);
      }
    }

    res.status(201).json({ order: Object.assign({}, order, { items: orderItems }) });
  } catch (error: any) {
    console.error('[Orders] Create error:', error);
    res.status(500).json({ error: error.message });
  }
});

router.post('/:id/items', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    if (['completed', 'cancelled'].includes((order as any).status)) {
      return res.status(400).json({ error: 'Cannot add items to a completed or cancelled order' });
    }

    const { items } = req.body;
    if (!items || items.length === 0) {
      return res.status(400).json({ error: 'At least one item is required' });
    }

    try {
      for (const item of items) {
        validateItemNotes(db, item.special_instructions);
      }
    } catch (err: any) {
      return res.status(400).json({ error: err.message });
    }

    // Get settings
    const settings: Record<string, string> = {};
    db.prepare('SELECT key, value FROM settings').all().forEach((row: any) => {
      settings[row.key] = row.value;
    });

    const tenantInfo = {
      country: settings.country || 'IN',
      business_type: settings.business_type || 'restaurant',
      state_code: settings.state_code || '',
    };

    const customer = (order as any).customer_id ? db.prepare('SELECT * FROM customers WHERE id = ?').get((order as any).customer_id) as any : null;

    const { updatedOrder, updatedItems } = withTxn(() => {
      const insertItem = db.prepare(`
        INSERT INTO order_items (order_id, product_id, product_name, product_sku, unit_price, quantity,
          subtotal, tax_amount, tax_breakdown, tax_type, discount_amount, total, variant_selection,
          modifier_selection, addons, special_instructions, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
      `);

      for (const item of items) {
        const product = db.prepare('SELECT * FROM products WHERE id = ?').get(item.product_id) as any;
        if (!product) {
          throw new Error(`Product ${item.product_id} not found`);
        }
        if (product.track_inventory && product.stock_quantity < item.quantity) {
          throw new Error(`Insufficient stock for ${product.name}`);
        }

        const unitPrice = parseFloat(product.price);
        const quantity = item.quantity;
        const itemDiscount = item.discount_amount || 0;

        let itemSubtotal = unitPrice * quantity;
        if (item.addons) {
          for (const addon of item.addons) {
            itemSubtotal += (addon.price || 0) * quantity;
          }
        }
        itemSubtotal = Math.max(0, itemSubtotal - itemDiscount);

        const taxResult = calculateItemTax(tenantInfo, product, itemSubtotal, customer);
        const itemTotal = itemSubtotal + taxResult.tax_amount;

        insertItem.run(
          req.params.id, product.id, product.name, product.sku, unitPrice, quantity,
          itemSubtotal, taxResult.tax_amount, JSON.stringify(taxResult.tax_breakdown),
          product.tax_type, itemDiscount, itemTotal,
          JSON.stringify(item.variant_selection || null),
          JSON.stringify(item.modifier_selection || null),
          JSON.stringify(item.addons || null),
          item.special_instructions || null, now(), now()
        );

        if (product.track_inventory) {
          db.prepare('UPDATE products SET stock_quantity = stock_quantity - ?, updated_at = ? WHERE id = ?')
            .run(quantity, now(), product.id);
        }
      }

      const orderItems = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(req.params.id) as any[];
      let subtotal = 0;
      let totalTax = 0;
      for (const item of orderItems) {
        subtotal += item.subtotal;
        totalTax += item.tax_amount;
      }

      const preRoundTotal = subtotal + totalTax + ((order as any).packaging_charge || 0);
      const roundOff = Math.round(preRoundTotal) - preRoundTotal;
      const total = Math.round(preRoundTotal) + roundOff;

      db.prepare(`
        UPDATE orders SET subtotal = ?, tax_amount = ?, total = ?, round_off = ?, updated_at = ? WHERE id = ?
      `).run(subtotal, totalTax, total, roundOff, now(), req.params.id);

      const updatedOrder = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id) as any;
      const updatedItems = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(req.params.id).map(parseItemJson);
      return { updatedOrder, updatedItems };
    });

    cloudSync.recordOrderChanged(req.params.id, 'order.updated');

    res.json({ order: Object.assign({}, updatedOrder, { items: updatedItems }) });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.patch('/:id/status', (req: Request, res: Response) => {
  try {
    const { status, reason } = req.body;

    if (!status) {
      return res.status(400).json({ error: 'Status is required' });
    }

    const validStatuses = ['preparing', 'ready', 'served', 'completed', 'cancelled'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: `Invalid status. Use: ${validStatuses.join(', ')}` });
    }

    // reason is optional for cancellation

    const db = getDatabase();
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    const nowStr = now();

    const { updatedOrder, orderItems, table } = withTxn(() => {
      switch (status) {
        case 'preparing':
          db.prepare('UPDATE orders SET status = ?, cooking_started_at = ?, updated_at = ? WHERE id = ?')
            .run(status, nowStr, nowStr, req.params.id);
          break;

        case 'ready':
          db.prepare('UPDATE orders SET status = ?, ready_at = ?, updated_at = ? WHERE id = ?')
            .run(status, nowStr, nowStr, req.params.id);
          break;

        case 'served':
          db.prepare('UPDATE orders SET status = ?, served_at = ?, updated_at = ? WHERE id = ?')
            .run(status, nowStr, nowStr, req.params.id);
          break;

        case 'completed':
          db.prepare('UPDATE orders SET status = ?, completed_at = ?, updated_at = ? WHERE id = ?')
            .run(status, nowStr, nowStr, req.params.id);
          db.prepare(`
            UPDATE order_items SET status = 'served', updated_at = ?
            WHERE order_id = ? AND status IN ('pending', 'preparing', 'ready')
          `).run(nowStr, req.params.id);
          if ((order as any).table_id) {
            db.prepare("UPDATE tables SET status = 'available', updated_at = ? WHERE id = ?")
              .run(nowStr, (order as any).table_id);
          }
          break;

        case 'cancelled': {
          const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(req.params.id) as any[];
          for (const item of items) {
            const product = db.prepare('SELECT * FROM products WHERE id = ?').get(item.product_id) as any;
            if (product && product.track_inventory) {
              db.prepare('UPDATE products SET stock_quantity = stock_quantity + ?, updated_at = ? WHERE id = ?')
                .run(item.quantity, nowStr, product.id);
            }
          }
          db.prepare('UPDATE orders SET status = ?, cancelled_at = ?, cancellation_reason = ?, updated_at = ? WHERE id = ?')
            .run(status, nowStr, reason, nowStr, req.params.id);
          if ((order as any).table_id) {
            db.prepare("UPDATE tables SET status = 'available', updated_at = ? WHERE id = ?")
              .run(nowStr, (order as any).table_id);
          }
          break;
        }
      }

      const updatedOrder = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id) as any;
      const orderItems = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(req.params.id).map(parseItemJson);
      const tableRow2 = updatedOrder.table_id ? db.prepare('SELECT * FROM tables WHERE id = ?').get(updatedOrder.table_id) as any : null;
      const table = tableRow2 ? { ...tableRow2, name: tableRow2.number } : null;
      return { updatedOrder, orderItems, table };
    });

    cloudSync.recordOrderChanged(req.params.id, `order.${status}`);

    res.json({ order: Object.assign({}, updatedOrder, { items: orderItems, table }) });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export const orderRoutes = router;
