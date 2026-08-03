// Contract for the `pnpm preview <app>` helpers (#1777) + the shared one-click
// URL builder. Run: node --test scripts/app-preview.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveApp, readLanding, findDevUrl, waitFor } from './app-preview.mjs'
import { buildLoginUrl } from './seed-review-login.mjs'

test('resolveApp finds an app in either workspace, apps/ first', () => {
  const exists = p => ['apps/kassa/package.json', 'pocs/notes/package.json'].includes(p)
  assert.deepEqual(resolveApp('kassa', exists), { workspace: 'apps', dir: 'apps/kassa' })
  assert.deepEqual(resolveApp('notes', exists), { workspace: 'pocs', dir: 'pocs/notes' })
  assert.equal(resolveApp('nope', exists), null)
})

test('readLanding reads reviewLogin.landing, and is silent when absent or unreadable', () => {
  const withLanding = () => JSON.stringify({ reviewLogin: { landing: '/admin/test1/x' } })
  assert.equal(readLanding('apps/kassa', withLanding), '/admin/test1/x')
  assert.equal(readLanding('apps/velo', () => JSON.stringify({ stagingUrl: 'x' })), '')
  assert.equal(readLanding('apps/gone', () => { throw new Error('ENOENT') }), '')
})

test('findDevUrl picks the localhost URL out of a Nuxt boot chunk', () => {
  assert.equal(findDevUrl('  ➜ Local:    http://localhost:3007/\n  ➜ Network: use --host'), 'http://localhost:3007')
  assert.equal(findDevUrl('ℹ Nuxt Icon server bundle mode is set to local'), null)
})

test('buildLoginUrl encodes the credentials — a bare + would decode as a space', () => {
  const url = buildLoginUrl({
    url: 'http://localhost:3007/',
    email: 'review+kassa-pr12@example.com',
    password: 'a+b c',
    landing: '/admin/test1/sales/events/vlaamsekermis'
  })
  const q = new URL(url).searchParams
  assert.equal(new URL(url).pathname, '/auth/login')
  assert.ok(!url.includes('review+kassa'), 'the + must be percent-encoded')
  // Round-trip is what matters: the app must read back exactly what we put in.
  assert.equal(q.get('email'), 'review+kassa-pr12@example.com')
  assert.equal(q.get('password'), 'a+b c')
  assert.equal(q.get('redirect'), '/admin/test1/sales/events/vlaamsekermis')
})

test('waitFor returns as soon as the check passes', async () => {
  let calls = 0
  const value = await waitFor(() => (++calls >= 3 ? 'ready' : null), { timeoutMs: 1000, intervalMs: 0 })
  assert.equal(value, 'ready')
  assert.equal(calls, 3)
})

test('waitFor gives up at the deadline and hands back the falsy value', async () => {
  // Injected clock: no real waiting, and the deadline is deterministic.
  let t = 0
  const value = await waitFor(() => false, {
    timeoutMs: 500,
    intervalMs: 100,
    now: () => t,
    sleep: async (ms) => { t += ms }
  })
  assert.equal(value, false)
  assert.ok(t >= 500, 'must not return before the timeout elapsed')
})

test('buildLoginUrl omits redirect when there is no landing path', () => {
  const url = buildLoginUrl({ url: 'https://kassa.pmcp.dev', email: 'a@b.c', password: 'p' })
  assert.equal(new URL(url).searchParams.get('redirect'), null)
})
