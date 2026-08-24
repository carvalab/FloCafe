import { getDb, settings } from './db'

export interface User {
  id: number
  name: string
  email: string
  role: string
}

export interface Store {
  name: string
  currencySymbol: string
}

export interface Session {
  user: User
  store: Store
}

const SESSION_FILE = '.flocafe-session.json'

/**
 * Verify credentials against the users table (same bcrypt hashes the
 * Electron app wrote) and load store info from settings.
 * FloCafe is single-tenant local — no tenant picker, no JWT; the session
 * stays in memory.
 */
export async function login(email: string, password: string): Promise<Session> {
  const normalized = email.trim().toLowerCase()
  let user: any
  try {
    user = getDb()
      .prepare('SELECT id, name, email, password, role FROM users WHERE email = ? AND is_active = 1')
      .get(normalized)
  } catch {
    throw new Error('Database not found — start with FLOCAFE_DB pointing at flo.db')
  }
  if (!user || !(await Bun.password.verify(password, user.password))) {
    throw new Error('Invalid email or password')
  }
  const s = settings()
  return {
    user: { id: user.id, name: user.name, email: user.email, role: user.role },
    store: {
      name: s.business_name || 'Store',
      currencySymbol: s.currency_symbol || '₹',
    },
  }
}

/** Restore a remembered session written by a previous "remember me" login. */
export function loadSession(): Session | null {
  try {
    return JSON.parse(require('node:fs').readFileSync(SESSION_FILE, 'utf8'))
  } catch {
    return null
  }
}

export function rememberSession(session: Session) {
  require('node:fs').writeFileSync(SESSION_FILE, JSON.stringify(session))
}
