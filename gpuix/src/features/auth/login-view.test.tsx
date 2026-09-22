import { expect, test } from 'bun:test'
import { hasNativeTestRenderer } from '@gpuix/react'
import { launch } from '@gpuix/react/automation'

// Works with the stock npm binary: drives the real app as a child process
// and inspects its retained element tree over the automation protocol.
test('login view mounts with all interactive elements', async () => {
  const app = await launch({ command: 'bun', args: ['app.tsx'] })
  try {
    // cold start compiles GPUI shaders; give the first paint room
    await app.getByTestId('login-email').waitFor({ timeoutMs: 15000 })
    await app.getByTestId('login-password').waitFor()
    await app.getByTestId('login-remember').waitFor()
    await app.getByTestId('login-submit').waitFor()

    expect(await app.getByTestId('home-view').all()).toHaveLength(0)
  } finally {
    await app.close()
  }
})

// Full click/fill flow needs the test-support native build (see AGENTS.md).
test('login flow end-to-end', async () => {
  if (!hasNativeTestRenderer) return console.log('skip: build @gpuix/native with test-support')
  const { createTestRoot } = await import('@gpuix/react')
  const { connectTest } = await import('@gpuix/react/automation')
  const { App } = await import('../../App')
  const { render, renderer } = createTestRoot()
  render(<App />)
  const app = await connectTest(renderer)

  await app.getByTestId('login-submit').click() // empty submit -> error
  await app.getByTestId('login-error').waitFor()
  expect(await app.getByTestId('login-error').textContent()).toContain('email')

  await app.getByTestId('login-email').fill('owner@flo.cafe')
  await app.getByTestId('login-password').fill('secret')
  await app.getByTestId('login-submit').click()

  await app.getByTestId('welcome').waitFor()
  expect(await app.getByTestId('welcome').textContent()).toContain('owner@flo.cafe')
})
