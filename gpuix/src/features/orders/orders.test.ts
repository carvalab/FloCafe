import { afterAll, beforeAll, expect, test } from 'bun:test'
import { Database } from 'bun:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const dir = mkdtempSync(path.join(tmpdir(), 'flocafe-orders-'))
process.env.FLOCAFE_DB = path.join(dir, 'test.db')

beforeAll(() => {
  const db = new Database(process.env.FLOCAFE_DB!)
  db.exec(`CREATE TABLE categories (id TEXT PRIMARY KEY, name TEXT, is_active INTEGER DEFAULT 1);
           CREATE TABLE addon_groups (id TEXT PRIMARY KEY, name TEXT, is_required INTEGER DEFAULT 0, min_selection INTEGER DEFAULT 0, max_selection INTEGER DEFAULT 1, is_active INTEGER DEFAULT 1);
           CREATE TABLE addons (id TEXT PRIMARY KEY, addon_group_id TEXT NOT NULL, name TEXT, price REAL DEFAULT 0, is_active INTEGER DEFAULT 1);
           CREATE TABLE addon_group_product (product_id TEXT NOT NULL, addon_group_id TEXT NOT NULL, PRIMARY KEY (product_id, addon_group_id));
           CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);
           CREATE TABLE products (id TEXT PRIMARY KEY, name TEXT, sku TEXT, price REAL, tax_rate REAL, track_inventory INTEGER, stock_quantity REAL, category_id TEXT, is_active INTEGER);
           CREATE TABLE orders (id INTEGER PRIMARY KEY AUTOINCREMENT, order_number TEXT UNIQUE NOT NULL, type TEXT DEFAULT 'takeaway', status TEXT DEFAULT 'pending', subtotal REAL DEFAULT 0, tax_amount REAL DEFAULT 0, total REAL DEFAULT 0, completed_at TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
           CREATE TABLE bills (id INTEGER PRIMARY KEY AUTOINCREMENT, bill_number TEXT UNIQUE NOT NULL, order_id INTEGER NOT NULL, subtotal REAL DEFAULT 0, tax_amount REAL DEFAULT 0, total REAL DEFAULT 0, paid_amount REAL DEFAULT 0, balance REAL DEFAULT 0, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
           CREATE TABLE order_items (id INTEGER PRIMARY KEY AUTOINCREMENT, order_id INTEGER NOT NULL, product_id TEXT NOT NULL, product_name TEXT NOT NULL, product_sku TEXT, unit_price REAL NOT NULL, quantity INTEGER NOT NULL DEFAULT 1, inventory_deducted_quantity REAL NOT NULL DEFAULT 0, subtotal REAL NOT NULL, tax_amount REAL DEFAULT 0, total REAL NOT NULL, addons TEXT, status TEXT DEFAULT 'pending', created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP)`)
  db.prepare('INSERT INTO products VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)').run('p1', 'Espresso', 'ESP', 10, 5, 1, 100, null)
  db.prepare('INSERT INTO products VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)').run('p2', 'Cake', 'CAK', 20, 0, 0, 0, null)
  db.prepare('INSERT INTO addon_groups VALUES (?, ?, 1, 1, 1, 1)').run('g1', 'Extras')
  db.prepare("INSERT INTO addons VALUES (?, 'g1', ?, ?, 1)").run('a1', 'Soy milk', 5)
  db.prepare("INSERT INTO addon_group_product VALUES ('p1', 'g1')")
  db.close()
})

afterAll(() => rmSync(dir, { recursive: true }))

test('createOrder inserts order + items and decrements tracked stock', async () => {
  const { createOrder, loadProducts } = await import('./orders')
  const byName = Object.fromEntries(loadProducts().map((p) => [p.name, p])) as any
  const orderId = createOrder([
    { ...byName['Espresso'], quantity: 2 }, // 2 × 10 @5% tax = 21.00
    { ...byName['Cake'], quantity: 1 }, // 1 × 20, no tax
  ])
  expect(orderId).toBe(1)

  const db = new Database(process.env.FLOCAFE_DB!)
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId) as any
  expect(order.order_number).toMatch(/^ORD-\d{8}-0001$/)
  expect(order.subtotal).toBe(40)
  expect(order.tax_amount).toBe(1)
  expect(order.total).toBe(41)

  expect((db.prepare('SELECT COUNT(*) n FROM order_items').get() as any).n).toBe(2)
  expect((db.prepare('SELECT stock_quantity FROM products WHERE id = ?').get('p1') as any).stock_quantity).toBe(98)

  createOrder([{ ...byName['Cake'], quantity: 1 }])
  expect((db.prepare('SELECT order_number FROM orders WHERE id = 2').get() as any).order_number.endsWith('-0002')).toBe(true)
  db.close()
})

test('createOrder prices addons and persists them as JSON', async () => {
  const { createOrder, loadProducts } = await import('./orders')
  const espresso = (loadProducts() as any).find((p: any) => p.name === 'Espresso')
  const orderId = createOrder([
    { ...espresso, quantity: 1, addons: [{ id: 'a1', name: 'Soy milk', price: 5 }] },
  ]) // (10+5) @5% = 15.75

  const db = new Database(process.env.FLOCAFE_DB!)
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId) as any
  expect(order.subtotal).toBe(15)
  expect(order.total).toBe(15.75)
  const item = db.prepare('SELECT * FROM order_items WHERE order_id = ?').get(orderId) as any
  expect(JSON.parse(item.addons)).toEqual([{ id: 'a1', name: 'Soy milk', price: 5 }])
  db.close()
})

test('order lifecycle: transitions, bill on completion, then payment', async () => {
  const { createOrder, loadProducts, updateOrderStatus, payBill } = await import('./orders')
  const byName = Object.fromEntries(loadProducts().map((p) => [p.name, p])) as any
  const id = createOrder([{ ...byName['Espresso'], quantity: 1 }])

  expect(() => updateOrderStatus(id, 'completed')).toThrow(/Cannot go from/)
  updateOrderStatus(id, 'preparing')
  updateOrderStatus(id, 'ready')
  updateOrderStatus(id, 'completed')

  const db = new Database(process.env.FLOCAFE_DB!)
  const order = db.prepare('SELECT status, completed_at FROM orders WHERE id = ?').get(id) as any
  expect(order.status).toBe('completed')
  expect(order.completed_at).toBeTruthy()
  const bill = db.prepare('SELECT * FROM bills WHERE order_id = ?').get(id) as any
  expect(bill.bill_number).toMatch(/^INV-\d{8}-0001$/)
  expect(bill.total).toBe(10.5)

  payBill(id)
  const paid = db.prepare('SELECT paid_amount, balance FROM bills WHERE order_id = ?').get(id) as any
  expect(paid.paid_amount).toBe(10.5)
  expect(paid.balance).toBe(0)
  expect(() => payBill(9999)).toThrow('No bill')
  db.close()
})

test('createOrder rejects an empty cart', async () => {
  const { createOrder } = await import('./orders')
  expect(() => createOrder([])).toThrow('Cart is empty')
})
