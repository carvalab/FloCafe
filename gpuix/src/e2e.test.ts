import { afterAll, beforeAll, expect, test } from 'bun:test'
import { Database } from 'bun:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

/**
 * Full POS journey against one seeded store DB — the flow a cashier walks
 * in the UI, exercised at the logic layer:
 * login → browse categories/addons → build cart with addons → hold → resume →
 * checkout → kitchen advance → complete+bill → pay.
 */
const dir = mkdtempSync(path.join(tmpdir(), 'flocafe-e2e-'))
process.env.FLOCAFE_DB = path.join(dir, 'store.db')

beforeAll(() => {
  const db = new Database(process.env.FLOCAFE_DB!)
  db.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, email TEXT, password TEXT, role TEXT, is_active INTEGER);
           CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);
           CREATE TABLE categories (id TEXT PRIMARY KEY, name TEXT, sort_order INTEGER DEFAULT 0, is_active INTEGER DEFAULT 1);
           CREATE TABLE addon_groups (id TEXT PRIMARY KEY, name TEXT, is_required INTEGER DEFAULT 0, min_selection INTEGER DEFAULT 0, max_selection INTEGER DEFAULT 1, sort_order INTEGER DEFAULT 0, is_active INTEGER DEFAULT 1);
           CREATE TABLE addons (id TEXT PRIMARY KEY, addon_group_id TEXT NOT NULL, name TEXT, price REAL DEFAULT 0, sort_order INTEGER DEFAULT 0, is_active INTEGER DEFAULT 1);
           CREATE TABLE addon_group_product (product_id TEXT NOT NULL, addon_group_id TEXT NOT NULL, PRIMARY KEY (product_id, addon_group_id));
           CREATE TABLE products (id TEXT PRIMARY KEY, name TEXT, sku TEXT, price REAL, tax_rate REAL, track_inventory INTEGER, stock_quantity REAL, category_id TEXT, is_active INTEGER);
           CREATE TABLE orders (id INTEGER PRIMARY KEY AUTOINCREMENT, order_number TEXT UNIQUE NOT NULL, type TEXT DEFAULT 'takeaway', status TEXT DEFAULT 'pending', subtotal REAL DEFAULT 0, tax_amount REAL DEFAULT 0, total REAL DEFAULT 0, completed_at TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
           CREATE TABLE bills (id INTEGER PRIMARY KEY AUTOINCREMENT, bill_number TEXT UNIQUE NOT NULL, order_id INTEGER NOT NULL, subtotal REAL DEFAULT 0, tax_amount REAL DEFAULT 0, total REAL DEFAULT 0, paid_amount REAL DEFAULT 0, balance REAL DEFAULT 0, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
           CREATE TABLE order_items (id INTEGER PRIMARY KEY AUTOINCREMENT, order_id INTEGER NOT NULL, product_id TEXT NOT NULL, product_name TEXT NOT NULL, product_sku TEXT, unit_price REAL NOT NULL, quantity INTEGER NOT NULL DEFAULT 1, inventory_deducted_quantity REAL NOT NULL DEFAULT 0, subtotal REAL NOT NULL, tax_amount REAL DEFAULT 0, total REAL NOT NULL, addons TEXT, status TEXT DEFAULT 'pending', created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
           CREATE TABLE held_orders (id TEXT PRIMARY KEY, table_id TEXT NOT NULL, items TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP)`)
  db.prepare('INSERT INTO users VALUES (1, ?, ?, ?, ?, 1)').run('Owner', 'owner@flo.cafe', Bun.password.hashSync('secret'), 'owner')
  db.prepare("INSERT INTO settings VALUES ('business_name', 'Junction Cafe')").run()
  db.prepare("INSERT INTO settings VALUES ('currency_symbol', '₹')").run()
  db.prepare("INSERT INTO settings VALUES ('timezone', 'Asia/Kolkata')").run()
  db.prepare("INSERT INTO categories VALUES ('c1', 'Coffee', 0, 1)").run()
  db.prepare("INSERT INTO products VALUES ('p1', 'Espresso', 'ESP', 10, 5, 1, 100, 'c1', 1)").run()
  db.prepare("INSERT INTO products VALUES ('p2', 'Cake', 'CAK', 20, 0, 0, 0, null, 1)").run()
  db.prepare("INSERT INTO addon_groups VALUES ('g1', 'Milk', 1, 1, 1, 0, 1)").run()
  db.prepare("INSERT INTO addons VALUES ('a1', 'g1', 'Soy milk', 5, 0, 1)").run()
  db.prepare("INSERT INTO addon_group_product VALUES ('p1', 'g1')").run()
  db.close()
})

afterAll(() => rmSync(dir, { recursive: true }))

test('cashier journey: login → cart w/ addons → hold/resume → checkout → kitchen → bill → pay', async () => {
  const auth = await import('./features/auth/auth')
  const products = await import('./features/products/products')
  const orders = await import('./features/orders/orders')
  const pos = await import('./features/pos/held')

  // login
  const session = await auth.login('owner@flo.cafe', 'secret')
  expect(session.store.name).toBe('Junction Cafe')

  // menu browsing
  expect(products.loadCategories().map((c) => c.name)).toEqual(['Coffee'])
  const espresso = products.loadProducts().find((p) => p.name === 'Espresso')!
  const groups = products.loadAddonGroups(espresso.productId)
  expect(groups[0].isRequired).toBe(1)
  expect(products.loadAddonGroups('p2')).toHaveLength(0)

  // cart: espresso + soy milk, cake plain; park it, then resume
  const soy = groups[0].addons[0]
  let cart = [
    { ...espresso, quantity: 1, addons: [soy] },
    { ...products.loadProducts().find((p) => p.name === 'Cake')!, quantity: 2 },
  ]
  pos.holdCart(cart, 'T4')
  expect(pos.listHeld()).toHaveLength(1)
  cart = pos.resumeHeld(pos.listHeld()[0].id)
  expect(pos.listHeld()).toHaveLength(0)

  // checkout: espresso+soy 15 @5% = 15.75, plus 2×20 cake = 40 → 55.75
  const orderId = orders.createOrder(cart)
  const db = new Database(process.env.FLOCAFE_DB!)
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId) as any
  expect(order.total).toBe(55.75)

  // kitchen advances pending → preparing → ready
  orders.updateOrderStatus(orderId, 'preparing')
  orders.updateOrderStatus(orderId, 'ready')

  // cashier completes + bills, then takes payment
  orders.updateOrderStatus(orderId, 'completed')
  orders.payBill(orderId)

  const bill = db.prepare('SELECT * FROM bills WHERE order_id = ?').get(orderId) as any
  expect(bill.bill_number).toMatch(/^INV-\d{8}-0001$/)
  expect(bill.paid_amount).toBe(55.75)
  expect(bill.balance).toBe(0)
  expect((db.prepare('SELECT stock_quantity FROM products WHERE id = ?').get('p1') as any).stock_quantity).toBe(99)
  db.close()
})
