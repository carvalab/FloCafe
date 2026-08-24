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
