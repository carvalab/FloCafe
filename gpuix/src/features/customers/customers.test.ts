import { afterAll, beforeAll, expect, test } from 'bun:test'
import { Database } from 'bun:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const dir = mkdtempSync(path.join(tmpdir(), 'flocafe-customers-'))
process.env.FLOCAFE_DB = path.join(dir, 'test.db')
beforeAll(() => {
  new Database(process.env.FLOCAFE_DB!).exec(`CREATE TABLE customers (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT, phone TEXT, is_active INTEGER DEFAULT 1, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP)`)
})
afterAll(() => rmSync(dir, { recursive: true }))

test('customer save/update/deactivate', async () => {
  const c = await import('./customers')
  const id = c.saveCustomer({ name: 'Ravi', phone: '999', email: 'ravi@x.in' })
  expect(c.loadCustomers()[0].name).toBe('Ravi')
  expect(() => c.saveCustomer({ name: ' ' })).toThrow('Name required')
  c.saveCustomer({ id, name: 'Ravi K', phone: null })
  expect(c.loadCustomers()[0].phone).toBeNull()
  c.deactivateCustomer(id)
  expect(c.loadCustomers()).toHaveLength(0)
})
