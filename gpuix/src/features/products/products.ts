import { randomUUID } from 'node:crypto'
import { getDb } from '../../shared/db'

export interface Category {
  id: string
  name: string
}

export interface Product {
  productId: string
  name: string
  sku: string | null
  price: number
  taxRate: number
  trackInventory: number
  stockQuantity: number
  categoryId: string | null
  categoryName: string | null
}

export interface Addon {
  id: string
  name: string
  price: number
}

export interface AddonGroup {
  id: string
  name: string
  isRequired: number
  minSelection: number
  maxSelection: number
  addons: Addon[]
}

export function loadCategories(): Category[] {
  return getDb()
    .prepare('SELECT id, name FROM categories WHERE is_active = 1 ORDER BY sort_order, name')
    .all() as Category[]
}

export function loadProducts(): Product[] {
  return getDb()
    .prepare(
      `SELECT p.id AS productId, p.name, p.sku, p.price, p.tax_rate AS taxRate,
              p.track_inventory AS trackInventory, p.stock_quantity AS stockQuantity,
              p.category_id AS categoryId, c.name AS categoryName
       FROM products p LEFT JOIN categories c ON c.id = p.category_id
       WHERE p.is_active = 1 ORDER BY p.name`,
    )
    .all() as Product[]
}

/** Addon groups attached to a product, each with its active addons. */
export function loadAddonGroups(productId: string): AddonGroup[] {
  const db = getDb()
  const groups = db
    .prepare(
      `SELECT g.id, g.name, g.is_required AS isRequired, g.min_selection AS minSelection, g.max_selection AS maxSelection
       FROM addon_groups g JOIN addon_group_product gp ON gp.addon_group_id = g.id
       WHERE gp.product_id = ? AND g.is_active = 1 ORDER BY g.sort_order`,
    )
    .all(productId) as AddonGroup[]
  const loadAddons = db.prepare(
    'SELECT id, name, price FROM addons WHERE addon_group_id = ? AND is_active = 1 ORDER BY sort_order',
  )
  for (const g of groups) g.addons = loadAddons.all(g.id) as Addon[]
  return groups
}

// ── menu management ──────────────────────────────────────────────────────────

export function saveCategory(id: string | null, name: string): string {
  if (!name.trim()) throw new Error('Name required')
  const db = getDb()
  const newId = id ?? randomUUID()
  if (id) db.prepare('UPDATE categories SET name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(name.trim(), id)
  else db.prepare('INSERT INTO categories (id, name, created_at, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)').run(newId, name.trim())
  return newId
}

export function deactivateCategory(id: string): void {
  getDb().prepare('UPDATE categories SET is_active = 0 WHERE id = ?').run(id)
}

/** Insert or update. price must be >= 0; taxRate 0–100. */
export function saveProduct(p: {
  productId?: string
  name: string
  sku?: string | null
  price: number
  taxRate: number
  trackInventory?: number
  stockQuantity?: number
  categoryId?: string | null
}): string {
  if (!p.name.trim()) throw new Error('Name required')
  if (!(p.price >= 0)) throw new Error('Price must be ≥ 0')
  if (!(p.taxRate >= 0 && p.taxRate <= 100)) throw new Error('Tax rate must be 0–100')
  const db = getDb()
  if (p.productId) {
    db.prepare(
      'UPDATE products SET name = ?, sku = ?, price = ?, tax_rate = ?, track_inventory = ?, stock_quantity = ?, category_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
    ).run(p.name.trim(), p.sku ?? null, p.price, p.taxRate, p.trackInventory ? 1 : 0, p.stockQuantity ?? 0, p.categoryId ?? null, p.productId)
    return p.productId
  }
  const id = randomUUID()
  db.prepare(
    'INSERT INTO products (id, name, sku, price, tax_rate, track_inventory, stock_quantity, category_id, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)',
  ).run(id, p.name.trim(), p.sku ?? null, p.price, p.taxRate, p.trackInventory ? 1 : 0, p.stockQuantity ?? 0, p.categoryId ?? null)
  return id
}

/** Soft delete — history must keep selling records intact. */
export function deactivateProduct(productId: string): void {
  getDb().prepare('UPDATE products SET is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(productId)
}

export function saveAddonGroup(id: string | null, name: string, isRequired: boolean): string {
  if (!name.trim()) throw new Error('Name required')
  const db = getDb()
  if (id) {
    db.prepare('UPDATE addon_groups SET name = ?, is_required = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(name.trim(), isRequired ? 1 : 0, id)
    return id
  }
  const newId = randomUUID()
  db.prepare('INSERT INTO addon_groups (id, name, is_required, created_at, updated_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)').run(newId, name.trim(), isRequired ? 1 : 0)
  return newId
}

export function saveAddon(groupdId: string, id: string | null, name: string, price: number): string {
  if (!name.trim()) throw new Error('Name required')
  if (!(price >= 0)) throw new Error('Price must be ≥ 0')
  const db = getDb()
  if (id) {
    db.prepare('UPDATE addons SET name = ?, price = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(name.trim(), price, id)
    return id
  }
  const newId = randomUUID()
  db.prepare('INSERT INTO addons (id, addon_group_id, name, price, created_at, updated_at) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)').run(newId, groupdId, name.trim(), price)
  return newId
}

export function linkAddonGroup(productId: string, addonGroupId: string): void {
  getDb().prepare('INSERT OR IGNORE INTO addon_group_product (product_id, addon_group_id) VALUES (?, ?)').run(productId, addonGroupId)
}

export function deactivateAddonGroup(id: string): void {
  getDb().prepare('UPDATE addon_groups SET is_active = 0 WHERE id = ?').run(id)
}

export function deactivateAddon(id: string): void {
  getDb().prepare('UPDATE addons SET is_active = 0 WHERE id = ?').run(id)
}
