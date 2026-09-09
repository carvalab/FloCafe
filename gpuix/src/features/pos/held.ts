import { randomUUID } from 'node:crypto'
import { getDb } from '../../shared/db'
import type { CartItem } from '../orders/orders'

export interface HeldCart {
  id: string
  label: string
  items: CartItem[]
}

/** Park a cart (per table/label) so the cashier can serve the next customer. */
export function holdCart(items: CartItem[], label: string): void {
  if (items.length === 0) throw new Error('Cart is empty')
  getDb()
    .prepare('INSERT INTO held_orders (id, table_id, items, created_at, updated_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)')
    .run(randomUUID(), label || 'pos', JSON.stringify(items))
}

export function listHeld(): HeldCart[] {
  return (getDb()
    .prepare('SELECT id, table_id, items FROM held_orders ORDER BY created_at')
    .all() as any[])
    .map((r) => ({ id: r.id, label: r.table_id, items: JSON.parse(r.items) }))
}

/** Restore a parked cart and remove it from the hold list. */
export function resumeHeld(id: string): CartItem[] {
  const db = getDb()
  const row: any = db.prepare('SELECT items FROM held_orders WHERE id = ?').get(id)
  if (!row) throw new Error(`Held order ${id} not found`)
  db.prepare('DELETE FROM held_orders WHERE id = ?').run(id)
  return JSON.parse(row.items)
}
