import { afterAll, beforeAll, expect, test } from 'bun:test'
import { Database } from 'bun:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const dir = mkdtempSync(path.join(tmpdir(), 'flocafe-held-'))
process.env.FLOCAFE_DB = path.join(dir, 'test.db')

beforeAll(() => {
  const db = new Database(process.env.FLOCAFE_DB!)
  db.exec(`CREATE TABLE held_orders (id TEXT PRIMARY KEY, table_id TEXT NOT NULL, items TEXT NOT NULL, customer_id TEXT, guest_count INTEGER DEFAULT 1, order_notes TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP)`)
  db.close()
})

afterAll(() => rmSync(dir, { recursive: true }))

test('hold → list → resume round-trips the cart', async () => {
  const { holdCart, listHeld, resumeHeld } = await import('./held')
  const cart = [{ productId: 'p1', name: 'Espresso', sku: null, price: 10, taxRate: 5, trackInventory: 1, stockQuantity: 9, quantity: 2 }]
  holdCart(cart, 'Table 4')

  const held = listHeld()
  expect(held).toHaveLength(1)
  expect(held[0].label).toBe('Table 4')
  expect(held[0].items[0].quantity).toBe(2)

  expect(resumeHeld(held[0].id)).toEqual(cart)
  expect(listHeld()).toHaveLength(0)
})

test('empty carts cannot be held; unknown ids fail loudly', async () => {
  const { holdCart, resumeHeld } = await import('./held')
  expect(() => holdCart([], 'x')).toThrow('Cart is empty')
  expect(() => resumeHeld('nope')).toThrow('not found')
})
