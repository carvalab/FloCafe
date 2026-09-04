import { getDb, settings } from '../../shared/db'

const FLOW: Record<string, string[]> = {
  pending: ['preparing', 'cancelled'],
  preparing: ['ready', 'cancelled'],
  ready: ['completed', 'cancelled'],
}

/** YYYYMMDD in the store's timezone (settings), UTC fallback. */
function dateStamp(): string {
  const tz = settings().timezone
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: tz || undefined })
      .format(new Date())
      .replace(/-/g, '')
  } catch {
    return new Date().toISOString().slice(0, 10).replace(/-/g, '')
  }
}

export interface CartAddon {
  id: string
  name: string
  price: number
}

export interface CartItem {
  productId: string
  name: string
  sku: string | null
  price: number
  taxRate: number
  trackInventory: number
  stockQuantity: number
  quantity: number
  addons?: CartAddon[]
}

/** Unit price including selected addons. */
export function lineUnitPrice(item: CartItem): number {
  return item.price + (item.addons ?? []).reduce((sum, a) => sum + a.price, 0)
}

export function loadProducts(): CartItem[] {
  return getDb()
    .prepare(
      'SELECT id AS productId, name, sku, price, tax_rate AS taxRate, track_inventory AS trackInventory, stock_quantity AS stockQuantity FROM products WHERE is_active = 1 ORDER BY name',
    )
    .all() as CartItem[]
}

/**
 * Insert one order + its items in a transaction, decrementing tracked stock.
 * ponytail: order/bill numbers ignore order_number_reset_daily — always daily.
 * main/db.ts generateOrderNumber is the reference if per-series buckets land.
 */
export function createOrder(items: CartItem[], type = 'takeaway'): number {
  if (items.length === 0) throw new Error('Cart is empty')
  const db = getDb()

  // addons inherit the parent product's tax rate (matches inherit_parent_tax default)
  const subtotal = items.reduce((sum, i) => sum + lineUnitPrice(i) * i.quantity, 0)
  const taxAmount = items.reduce((sum, i) => sum + lineUnitPrice(i) * i.quantity * (i.taxRate / 100), 0)
  const total = Math.round((subtotal + taxAmount) * 100) / 100

  const s = settings()
  const prefix = s.order_number_prefix || 'ORD'
  const stamp = s.order_number_include_date === 'false' ? '' : dateStamp()
  const maxRow = db
    .prepare('SELECT MAX(CAST(SUBSTR(order_number, -4) AS INTEGER)) AS n FROM orders WHERE order_number LIKE ?')
    .get(`${prefix}${stamp ? '-' : ''}${stamp}-%`) as any
  const orderNumber = [prefix, stamp, String((maxRow?.n ?? 0) + 1).padStart(4, '0')].filter(Boolean).join('-')

  let orderId: number
  const tx = db.transaction(() => {
    orderId = Number(
      db
        .prepare(
          "INSERT INTO orders (order_number, type, status, subtotal, tax_amount, total, created_at, updated_at) VALUES (?, ?, 'pending', ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)",
        )
        .run(orderNumber, type, subtotal, taxAmount, total).lastInsertRowid,
    )
    const insertItem = db.prepare(
      "INSERT INTO order_items (order_id, product_id, product_name, product_sku, unit_price, quantity, inventory_deducted_quantity, subtotal, tax_amount, total, addons, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, 'pending', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)",
    )
    const deductStock = db.prepare('UPDATE products SET stock_quantity = stock_quantity - ? WHERE id = ? AND track_inventory = 1')
    for (const i of items) {
      const unit = lineUnitPrice(i)
      insertItem.run(orderId, i.productId, i.name, i.sku, unit, i.quantity, unit * i.quantity, (unit * i.quantity * i.taxRate) / 100, unit * i.quantity,
        i.addons?.length ? JSON.stringify(i.addons) : null)
      if (i.trackInventory) deductStock.run(i.quantity, i.productId)
    }
  })
  tx()
  return orderId!
}


/** Allowed next statuses. Completing also issues the bill. */
export function updateOrderStatus(orderId: number, status: string): void {
  const db = getDb()
  const order: any = db.prepare('SELECT id, status FROM orders WHERE id = ?').get(orderId)
  if (!order) throw new Error('Order not found')
  if (!(FLOW[order.status] ?? []).includes(status)) {
    throw new Error(`Cannot go from ${order.status} to ${status}`)
  }

  db.transaction(() => {
    if (status === 'completed') {
      const o: any = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId)
      const seq =
        (db
          .prepare('SELECT MAX(CAST(SUBSTR(bill_number, -4) AS INTEGER)) AS n FROM bills WHERE bill_number LIKE ?')
          .get(`INV-${dateStamp()}-%`) as any)?.n ?? 0
      db.prepare(
        "INSERT INTO bills (bill_number, order_id, subtotal, tax_amount, total, created_at, updated_at) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)",
      ).run(`INV-${dateStamp()}-${String(seq + 1).padStart(4, '0')}`, orderId, o.subtotal, o.tax_amount, o.total)
      db.prepare("UPDATE orders SET status = 'completed', completed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(orderId)
    } else {
      db.prepare('UPDATE orders SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(status, orderId)
    }
  })()
}


/** Record full payment on an order's bill. Partial payments come with parity need. */
export function payBill(orderId: number): void {
  const db = getDb()
  const bill: any = db.prepare('SELECT id, total FROM bills WHERE order_id = ?').get(orderId)
  if (!bill) throw new Error('No bill for this order')
  db.prepare('UPDATE bills SET paid_amount = total, balance = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(bill.id)
}
