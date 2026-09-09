import { randomUUID } from 'node:crypto'
import { getDb } from '../../shared/db'

export interface CustomerRow {
  id: string
  name: string
  phone: string | null
  email: string | null
}

export function loadCustomers(): CustomerRow[] {
  return getDb()
    .prepare('SELECT id, name, phone, email FROM customers WHERE is_active = 1 ORDER BY name')
    .all() as CustomerRow[]
}

/** Insert or update a customer. Name required; phone/email optional. */
export function saveCustomer(c: { id?: string; name: string; phone?: string | null; email?: string | null }): string {
  if (!c.name.trim()) throw new Error('Name required')
  const db = getDb()
  if (c.id) {
    db.prepare('UPDATE customers SET name = ?, phone = ?, email = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(
      c.name.trim(), c.phone?.trim() || null, c.email?.trim() || null, c.id,
    )
    return c.id
  }
  const id = randomUUID()
  db.prepare('INSERT INTO customers (id, name, phone, email, created_at, updated_at) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)').run(
    id, c.name.trim(), c.phone?.trim() || null, c.email?.trim() || null,
  )
  return id
}

export function deactivateCustomer(id: string): void {
  getDb().prepare('UPDATE customers SET is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(id)
}
