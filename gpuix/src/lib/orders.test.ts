import { afterAll, beforeAll, expect, test } from 'bun:test'
import { Database } from 'bun:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const dir = mkdtempSync(path.join(tmpdir(), 'flocafe-orders-'))
process.env.FLOCAFE_DB = path.join(dir, 'test.db')

beforeAll(() => {
  const db = new Database(process.env.FLOCAFE_DB!)
  db.exec(`CREATE TABLE products (id TEXT PRIMARY KEY, name TEXT, sku TEXT, price REAL, tax_rate REAL, track_inventory INTEGER, stock_quantity REAL, is_active INTEGER);
           CREATE TABLE orders (id INTEGER PRIMARY KEY AUTOINCREMENT, order_number TEXT UNIQUE NOT NULL, type TEXT DEFAULT 'takeaway', status TEXT DEFAULT 'pending', subtotal REAL DEFAULT 0, tax_amount REAL DEFAULT 0, total REAL DEFAULT 0, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
           CREATE TABLE order_items (id INTEGER PRIMARY KEY AUTOINCREMENT, order_id INTEGER NOT NULL, product_id TEXT NOT NULL, product_name TEXT NOT NULL, product_sku TEXT, unit_price REAL NOT NULL, quantity INTEGER NOT NULL DEFAULT 1, inventory_deducted_quantity REAL NOT NULL DEFAULT 0, subtotal REAL NOT NULL, tax_amount REAL DEFAULT 0, total REAL NOT NULL, status TEXT DEFAULT 'pending', created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP)`)
  db.prepare('INSERT INTO products VALUES (?, ?, ?, ?, ?, ?, ?, 1)').run('p1', 'Espresso', 'ESP', 10, 5, 1, 100)
  db.prepare('INSERT INTO products VALUES (?, ?, ?, ?, ?, ?, ?, 1)').run('p2', 'Cake', 'CAK', 20, 0, 0, 0)
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
  expect((db.prepare('SELECT stock_quantity FROM products WHERE id = ?').get('p2') as any).stock_quantity).toBe(0)

  // second order today continues the sequence
  createOrder([{ ...byName['Cake'], quantity: 1 }])
  expect((db.prepare("SELECT order_number FROM orders WHERE id = 2").get() as any).order_number.endsWith('-0002')).toBe(true)
  db.close()
})

test('createOrder rejects an empty cart', async () => {
  const { createOrder } = await import('./orders')
  expect(() => createOrder([])).toThrow('Cart is empty')
})
