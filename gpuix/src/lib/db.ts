import { Database } from 'bun:sqlite'

// ponytail: read-only until a view writes; flip when orders creation lands.
const dbPath = process.env.FLOCAFE_DB ?? 'flo.db'
let instance: Database | null = null

/** Lazy singleton — the window must open even without a database file. */
export function getDb(): Database {
  if (!instance) {
    try {
      instance = new Database(dbPath, { readonly: true })
    } catch {
      throw new Error(`Database not found at ${dbPath} (set FLOCAFE_DB)`)
    }
  }
  return instance
}

/** settings table as one plain object (business name, currency, …). */
export function settings(): Record<string, string> {
  return Object.fromEntries(
    getDb().prepare('SELECT key, value FROM settings').all().map((r: any) => [r.key, r.value]),
  )
}
