import { afterAll, beforeAll, expect, test } from 'bun:test'
import { Database } from 'bun:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const dir = mkdtempSync(path.join(tmpdir(), 'flocafe-tables-'))
process.env.FLOCAFE_DB = path.join(dir, 'test.db')
beforeAll(() => {
  new Database(process.env.FLOCAFE_DB!).exec("CREATE TABLE tables (id TEXT PRIMARY KEY, number TEXT NOT NULL UNIQUE, capacity INTEGER DEFAULT 4, status TEXT DEFAULT 'available', is_active INTEGER DEFAULT 1, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP)")
})
afterAll(() => rmSync(dir, { recursive: true }))

test('tables CRUD', async () => {
  const t = await import('./tables')
  const id = t.saveTable(null, 'T9', 4)
  expect(t.loadTables().map((x) => x.number)).toContain('T9')
  expect(() => t.saveTable(null, '', 2)).toThrow('Number required')
  expect(() => t.saveTable(null, 'T10', 0)).toThrow('Capacity must be')
  t.cycleStatus(id)
  expect(t.loadTables().find((x) => x.id === id)!.status).toBe('occupied')
  t.deactivateTable(id)
  expect(t.loadTables().find((x) => x.id === id)).toBeUndefined()
})
