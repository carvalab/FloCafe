import { randomUUID } from 'node:crypto'
import { getDb } from '../../shared/db'

export interface TableRow {
  id: string
  number: string
  capacity: number
  status: string
}

export function loadTables(): TableRow[] {
  return getDb()
    .prepare('SELECT id, number, capacity, status FROM tables WHERE is_active = 1 ORDER BY number')
    .all() as TableRow[]
}

export function cycleStatus(id: string): void {
  const t: any = getDb().prepare('SELECT status FROM tables WHERE id = ?').get(id)
  if (!t) throw new Error('Table not found')
  const next = t.status === 'available' ? 'occupied' : 'available'
  getDb().prepare('UPDATE tables SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(next, id)
}

export function saveTable(id: string | null, number: string, capacity: number): string {
  if (!String(number).trim()) throw new Error('Number required')
  if (!(capacity >= 1)) throw new Error('Capacity must be ≥ 1')
  const db = getDb()
  if (id) {
    db.prepare('UPDATE tables SET number = ?, capacity = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(String(number).trim(), capacity, id)
    return id
  }
  const newId = randomUUID()
  db.prepare('INSERT INTO tables (id, number, capacity, created_at, updated_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)').run(newId, String(number).trim(), capacity)
  return newId
}

export function deactivateTable(id: string): void {
  getDb().prepare('UPDATE tables SET is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(id)
}
