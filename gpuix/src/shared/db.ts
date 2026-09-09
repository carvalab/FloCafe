import { Database } from 'bun:sqlite'

const dbPath = () => process.env.FLOCAFE_DB ?? 'flo.db'
let instance: Database | null = null

/** Lazy singleton — the window must open even without a database file. */
export function getDb(): Database {
  const path = dbPath()
  if (!instance || (instance as any).__path !== path) {
    try {
      instance = new Database(path)
      ;(instance as any).__path = path
      instance.exec('PRAGMA foreign_keys = ON')
    } catch {
      throw new Error(`Database not found at ${path} (set FLOCAFE_DB)`)
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
