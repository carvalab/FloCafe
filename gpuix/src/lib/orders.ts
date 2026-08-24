import { getDb } from './db'

export interface CartItem {
  productId: string
  name: string
  sku: string | null
  price: number
  taxRate: number
  trackInventory: number
  stockQuantity: number
  quantity: number
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
 * ponytail: order number uses UTC date and per-day max+1 — store-timezone
 * and prefix/reset settings arrive with the settings view (main/db.ts
 * generateOrderNumber is the reference).
 */
export function createOrder(items: CartItem[], type = 'takeaway'): number {
  if (items.length === 0) throw new Error('Cart is empty')
  const db = getDb()

  const subtotal = items.reduce((sum, i) => sum + i.price * i.quantity, 0)
  const taxAmount = items.reduce((sum, i) => sum + i.price * i.quantity * (i.taxRate / 100), 0)
  const total = Math.round((subtotal + taxAmount) * 100) / 100

  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '')
  const maxRow = db
    .prepare('SELECT MAX(CAST(SUBSTR(order_number, -4) AS INTEGER)) AS n FROM orders WHERE order_number LIKE ?')
    .get(`ORD-${stamp}-%`) as any
  const orderNumber = `ORD-${stamp}-${String((maxRow?.n ?? 0) + 1).padStart(4, '0')}`

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
      "INSERT INTO order_items (order_id, product_id, product_name, product_sku, unit_price, quantity, inventory_deducted_quantity, subtotal, tax_amount, total, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, 'pending', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)",
    )
    const deductStock = db.prepare('UPDATE products SET stock_quantity = stock_quantity - ? WHERE id = ? AND track_inventory = 1')
    for (const i of items) {
      insertItem.run(orderId, i.productId, i.name, i.sku, i.price, i.quantity, i.price * i.quantity, (i.price * i.quantity * i.taxRate) / 100, i.price * i.quantity)
      if (i.trackInventory) deductStock.run(i.quantity, i.productId)
    }
  })
  tx()
  return orderId!
}
