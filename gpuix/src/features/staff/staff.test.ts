import { afterAll, beforeAll, expect, test } from 'bun:test'
import { Database } from 'bun:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const dir = mkdtempSync(path.join(tmpdir(), 'flocafe-staff-'))
process.env.FLOCAFE_DB = path.join(dir, 'test.db')
beforeAll(() => {
  new Database(process.env.FLOCAFE_DB!).exec(`CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, email TEXT UNIQUE, password TEXT, role TEXT CHECK (role IN ('owner','manager','cashier','server','chef')), is_active INTEGER DEFAULT 1, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP)`)
})
afterAll(() => rmSync(dir, { recursive: true }))

test('staff creation validates role/email uniqueness and hashes like the legacy app', async () => {
  const s = await import('./staff')
  const id = await s.createStaff('Priya', 'Priya@Flo.cafe', 'pass123', 'cashier')
  expect(id).toBeGreaterThan(0)

  const db = new Database(process.env.FLOCAFE_DB!)
  const row: any = db.prepare('SELECT * FROM users WHERE id = ?').get(id)
  expect(row.email).toBe('priya@flo.cafe')
  expect(await Bun.password.verify('pass123', row.password)).toBe(true)
  db.close()

  await expect(s.createStaff('Dup', 'priya@flo.cafe', 'x', 'chef')).rejects.toThrow('already registered')
  await expect(s.createStaff('Bad', 'bad@flo.cafe', 'x', 'admin')).rejects.toThrow('Role must be')
  await s.setStaffActive(id, false)
  const staff = s.loadStaff().find((u) => u.id === id)!
  expect(staff.is_active).toBe(0)
})
