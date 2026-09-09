import { getDb } from '../../shared/db'

const ROLES = ['owner', 'manager', 'cashier', 'server', 'chef']

export interface StaffRow {
  id: number
  name: string
  email: string
  role: string
  is_active: number
}

export function loadStaff(): StaffRow[] {
  return getDb().prepare('SELECT id, name, email, role, is_active FROM users ORDER BY name').all() as StaffRow[]
}

/**
 * Create a staff login. Passwords use the same bcrypt format the legacy app
 * verifies (Bun.password), so accounts work in both apps during migration.
 */
export async function createStaff(name: string, email: string, password: string, role: string): Promise<number> {
  if (!name.trim() || !email.trim()) throw new Error('Name and email required')
  if (!password) throw new Error('Password required')
  if (!ROLES.includes(role)) throw new Error(`Role must be one of ${ROLES.join(', ')}`)
  const normalized = email.trim().toLowerCase()
  const exists = getDb().prepare('SELECT id FROM users WHERE email = ?').get(normalized)
  if (exists) throw new Error('Email already registered')
  const hash = await Bun.password.hash(password)
  return Number(
    getDb()
      .prepare("INSERT INTO users (name, email, password, role, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)")
      .run(name.trim(), normalized, hash, role).lastInsertRowid,
  )
}

export function setStaffActive(id: number, active: boolean): void {
  getDb().prepare('UPDATE users SET is_active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(active ? 1 : 0, id)
}
