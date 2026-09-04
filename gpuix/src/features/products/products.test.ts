import { afterAll, beforeAll, expect, test } from 'bun:test'
import { Database } from 'bun:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const dir = mkdtempSync(path.join(tmpdir(), 'flocafe-products-'))
process.env.FLOCAFE_DB = path.join(dir, 'test.db')

beforeAll(() => {
  const db = new Database(process.env.FLOCAFE_DB!)
  db.exec(`CREATE TABLE categories (id TEXT PRIMARY KEY, name TEXT, sort_order INTEGER DEFAULT 0, is_active INTEGER DEFAULT 1, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
           CREATE TABLE products (id TEXT PRIMARY KEY, name TEXT, sku TEXT, price REAL, tax_rate REAL, track_inventory INTEGER, stock_quantity REAL, category_id TEXT, is_active INTEGER DEFAULT 1, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
           CREATE TABLE addon_groups (id TEXT PRIMARY KEY, name TEXT, is_required INTEGER DEFAULT 0, min_selection INTEGER DEFAULT 0, max_selection INTEGER DEFAULT 1, sort_order INTEGER DEFAULT 0, is_active INTEGER DEFAULT 1, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
           CREATE TABLE addons (id TEXT PRIMARY KEY, addon_group_id TEXT NOT NULL, name TEXT, price REAL DEFAULT 0, sort_order INTEGER DEFAULT 0, is_active INTEGER DEFAULT 1, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
           CREATE TABLE addon_group_product (product_id TEXT NOT NULL, addon_group_id TEXT NOT NULL, PRIMARY KEY (product_id, addon_group_id))`)
  db.close()
})

afterAll(() => rmSync(dir, { recursive: true }))

test('category + product CRUD round-trip', async () => {
  const p = await import('./products')
  const catId = p.saveCategory(null, 'Coffee')
  expect(p.loadCategories().map((c) => c.name)).toEqual(['Coffee'])

  const id = p.saveProduct({ name: 'Latte', price: 30, taxRate: 5, trackInventory: true, stockQuantity: 10, categoryId: catId })
  let latte = p.loadProducts().find((x) => x.productId === id)!
  expect(latte.categoryName).toBe('Coffee')

  expect(() => p.saveProduct({ name: '', price: 1, taxRate: 0 })).toThrow('Name required')
  expect(() => p.saveProduct({ name: 'X', price: -1, taxRate: 0 })).toThrow('Price must be')
  expect(() => p.saveProduct({ name: 'X', price: 1, taxRate: 500 })).toThrow('Tax rate must be')

  p.saveProduct({ productId: id, name: 'Latte Macchiato', sku: 'LAT', price: 32, taxRate: 5 })
  latte = p.loadProducts().find((x) => x.productId === id)!
  expect(latte.name).toBe('Latte Macchiato')
  expect(latte.price).toBe(32)

  p.deactivateProduct(id)
  expect(p.loadProducts().find((x) => x.productId === id)).toBeUndefined()
})

test('addon group + addon management', async () => {
  const p = await import('./products')
  const gid = p.saveAddonGroup(null, 'Extras', true)
  const aid = p.saveAddon(gid, null, 'Oat milk', 8)
  p.linkAddonGroup('p-any', gid)

  const groups = p.loadAddonGroups('p-any')
  expect(groups[0].isRequired).toBe(1)
  expect(groups[0].addons.map((a) => a.name)).toEqual(['Oat milk'])

  p.saveAddonGroup(gid, 'Extra shots', false)
  p.saveAddon(gid, aid, 'Oat milk large', 9)
  const [g] = p.loadAddonGroups('p-any')
  expect(g.isRequired).toBe(0)
  expect(g.addons[0].price).toBe(9)

  expect(() => p.saveAddon(gid, null, '', 1)).toThrow('Name required')
})
