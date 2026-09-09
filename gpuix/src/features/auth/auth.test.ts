import { afterAll, beforeAll, expect, test } from 'bun:test'
import { Database } from 'bun:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const dir = mkdtempSync(path.join(tmpdir(), 'flocafe-auth-'))
process.env.FLOCAFE_DB = path.join(dir, 'test.db')

// seed before the module under test opens the file
{
  const db = new Database(process.env.FLOCAFE_DB)
  db.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, email TEXT, password TEXT, role TEXT, is_active INTEGER);
           CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT)`)
  db.prepare('INSERT INTO users VALUES (1, ?, ?, ?, ?, 1)').run(
    'Owner',
    'owner@flo.cafe',
    await Bun.password.hash('secret'),
    'admin',
  )
  db.prepare('INSERT INTO settings VALUES (?, ?)').run('business_name', 'Test Cafe')
  db.close()
}

const { login } = await import('./auth')

afterAll(() => rmSync(dir, { recursive: true }))

test('login accepts valid bcrypt credentials', async () => {
  const s = await login('Owner@Flo.cafe', 'secret') // case/whitespace normalized
  expect(s.user.name).toBe('Owner')
  expect(s.store.name).toBe('Test Cafe')
})

test('login rejects wrong password and unknown user', async () => {
  await login('owner@flo.cafe', 'wrong').catch((e) => e).then((e) => expect(e).toBeInstanceOf(Error))
  await login('nobody@flo.cafe', 'secret').catch((e) => e).then((e) => expect(e).toBeInstanceOf(Error))
})
