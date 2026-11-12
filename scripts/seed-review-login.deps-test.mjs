// #3141 (R4) cases that need better-auth installed (its real hasher), so they run in the
// "Build packages" job, not the bare-Node set (scripts/bare-node-imports.test.mjs).
//   node --test scripts/seed-review-login.deps-test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { r4Db, row, runR4, SESSION_COOKIE } from './seed-review-login.fixtures.mjs'

test('R4 existing review account whose password changed still gets a working login', async () => {
  const req = createRequire(new URL('../packages/crouton-auth/package.json', import.meta.url))
  const { verifyPassword } = await import(pathToFileURL(req.resolve('better-auth/crypto')).href)
  const file = r4Db({ withUser: true })
  const r = await runR4(file, async (path) => {
    if (path === '/api/auth/sign-up/email') return { body: { token: null } } // verification on: hides "exists"
    if (path === '/api/auth/sign-in/email') {
      const { password } = row(file, `SELECT "password" FROM "account" WHERE "userId" = 'u1'`)
      const ok = await verifyPassword({ hash: password, password: 'pw' }).catch(() => false)
      return ok ? { body: { token: 'tok' }, headers: SESSION_COOKIE } : { status: 401, body: { code: 'INVALID_EMAIL_OR_PASSWORD' } }
    }
    if (path === '/api/auth/get-session') return { body: { user: { id: 'u1' }, session: {} } }
  })
  assert.equal(r.code, 0, r.out)
  assert.notEqual(row(file, `SELECT "password" FROM "account" WHERE "id" = 'a1'`).password, 'hash-of-an-old-password')
  assert.equal(row(file, `SELECT "emailVerified" AS v FROM "user" WHERE "id" = 'u1'`).v, 1)
  assert.equal(r.calls.filter(c => c.url === '/api/auth/sign-up/email').length, 0, 'sign-up is never called')
})

// Owner review on #3807 (Qodo 1 + 2): the 0006 backfill marks every account verified,
// so a stranger who pre-registered the review address must lose every session when
// the seed resets the password — regardless of emailVerified.
test('R4 password reset revokes every session of the review account, even a verified one', async () => {
  const req = createRequire(new URL('../packages/crouton-auth/package.json', import.meta.url))
  const { verifyPassword } = await import(pathToFileURL(req.resolve('better-auth/crypto')).href)
  const file = r4Db({ withUser: true, verified: true, sessions: [['s-stranger', 'u1'], ['s-other', 'u2']] })
  const r = await runR4(file, async (path) => {
    if (path === '/api/auth/sign-in/email') {
      const { password } = row(file, `SELECT "password" FROM "account" WHERE "userId" = 'u1'`)
      const ok = await verifyPassword({ hash: password, password: 'pw' }).catch(() => false)
      return ok ? { body: { token: 'tok' }, headers: SESSION_COOKIE } : { status: 401, body: { code: 'INVALID_EMAIL_OR_PASSWORD' } }
    }
    if (path === '/api/auth/get-session') return { body: { user: { id: 'u1' }, session: {} } }
  })
  assert.equal(r.code, 0, r.out)
  assert.equal(row(file, `SELECT count(*) AS n FROM "session" WHERE "id" = 's-stranger'`).n, 0, 'stranger signed out')
  assert.equal(row(file, `SELECT count(*) AS n FROM "session" WHERE "id" = 's-other'`).n, 1, 'other accounts untouched')
})
