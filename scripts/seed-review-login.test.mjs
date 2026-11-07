// The review login's password reset (#2358). When REVIEW_SEED_SECRET is rotated, the
// review account already exists with the OLD password; the deploy must move it to the new
// one — otherwise the old (guessable) password keeps working and the deploy smoke, which
// signs in with the new one, goes red. Runs the real SQL against an in-memory SQLite db.
//   node --test scripts/seed-review-login.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { resetPasswordSql } from './seed-review-login.mjs'

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite')

// Stand-in hasher: the SQL is what's under test; better-auth's real hasher is loaded
// in the deploy (and checked separately below).
const fakeHash = async (pw) => `hash(${pw})`

function db() {
  const d = new DatabaseSync(':memory:')
  d.exec(`
    CREATE TABLE "user" ("id" TEXT PRIMARY KEY, "email" TEXT);
    CREATE TABLE "account" ("id" TEXT PRIMARY KEY, "userId" TEXT, "providerId" TEXT, "password" TEXT);
    INSERT INTO "user" VALUES ('u1', 'review+velo-main@example.com'), ('u2', 'someone@example.com');
    INSERT INTO "account" VALUES
      ('a1', 'u1', 'credential', 'hash(old)'),
      ('a2', 'u1', 'github',     NULL),
      ('a3', 'u2', 'credential', 'hash(theirs)');
  `)
  return d
}

const pw = (d, id) => d.prepare('SELECT "password" FROM "account" WHERE "id" = ?').get(id).password

test('sets the review user\'s credential password to the new one', async () => {
  const d = db()
  d.exec(await resetPasswordSql('review+velo-main@example.com', 'new', fakeHash))
  assert.equal(pw(d, 'a1'), 'hash(new)')
})

test('leaves every other account alone (other users, non-password logins)', async () => {
  const d = db()
  d.exec(await resetPasswordSql('review+velo-main@example.com', 'new', fakeHash))
  assert.equal(pw(d, 'a2'), null)
  assert.equal(pw(d, 'a3'), 'hash(theirs)')
})

test('an unknown email changes nothing', async () => {
  const d = db()
  d.exec(await resetPasswordSql('nobody@example.com', 'new', fakeHash))
  assert.equal(pw(d, 'a1'), 'hash(old)')
  assert.equal(pw(d, 'a3'), 'hash(theirs)')
})

test('quotes in the email or hash cannot break out of the statement', async () => {
  const d = db()
  d.exec(await resetPasswordSql("x' OR '1'='1", "it's", fakeHash))
  assert.equal(pw(d, 'a1'), 'hash(old)')
  assert.equal(pw(d, 'a3'), 'hash(theirs)')
})

test('the default hasher is better-auth\'s, so a login can verify the stored value', async (t) => {
  let verifyPassword
  try {
    const req = createRequire(new URL('../packages/crouton-auth/package.json', import.meta.url))
    ;({ verifyPassword } = await import(req.resolve('better-auth/crypto')))
  } catch {
    t.skip('better-auth not installed in this checkout')
    return
  }
  const sql = await resetPasswordSql('review+velo-main@example.com', 'new-secret')
  const hash = sql.match(/SET "password" = '([^']+)'/)[1]
  assert.equal(await verifyPassword({ hash, password: 'new-secret' }), true)
})

// ── #3138 R4: the review login keeps working once email verification is required ─────
// With verification on, sign-up for an existing email answers 200 with NO session, and an
// unverified/old-password sign-in is refused. Drive the real script against a fake auth
// server + a real SQLite file: it must reset the password, mark the email verified, and
// end with a working sign-in (exit 0, not the "NOT advertising this login" exit 1).
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { verifyEmailSql } from './seed-review-login.mjs'

test('verifyEmailSql marks only the review user verified', () => {
  const d = new DatabaseSync(':memory:')
  d.exec(`CREATE TABLE "user" ("id" TEXT, "email" TEXT, "emailVerified" INTEGER);
    INSERT INTO "user" VALUES ('u1','r@example.com',0),('u2','o@example.com',0);`)
  d.exec(verifyEmailSql('r@example.com'))
  assert.deepEqual(d.prepare('SELECT "id","emailVerified" FROM "user" ORDER BY "id"').all().map(r => [r.id, r.emailVerified]), [['u1', 1], ['u2', 0]])
})

test('existing unverified account + old password + sign-up 200 without session → reset, verify, sign in', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'seed-login-'))
  const file = join(dir, 'sqlite.db')
  const d = new DatabaseSync(file)
  d.exec(`CREATE TABLE "user" ("id" TEXT PRIMARY KEY, "email" TEXT, "emailVerified" INTEGER);
    CREATE TABLE "account" ("id" TEXT PRIMARY KEY, "userId" TEXT, "providerId" TEXT, "password" TEXT);
    INSERT INTO "user" VALUES ('u1','review+x@example.com',0);
    INSERT INTO "account" VALUES ('a1','u1','credential','old-hash');`)
  d.close()
  const calls = []
  const server = createServer((req, res) => {
    let body = ''
    req.on('data', c => (body += c))
    req.on('end', () => {
      calls.push(req.url)
      res.setHeader('content-type', 'application/json')
      if (req.url === '/api/auth/sign-up/email') return res.end(JSON.stringify({ token: null, user: null }))
      if (req.url === '/api/auth/sign-in/email') {
        // Works only after the script reset the password AND verified the email.
        const check = new DatabaseSync(file)
        const ok = check.prepare('SELECT 1 AS ok FROM "user" u JOIN "account" a ON a."userId"=u."id" WHERE u."emailVerified"=1 AND a."password"<>\'old-hash\'').get()
        check.close()
        res.statusCode = ok ? 200 : 403
        return res.end(JSON.stringify(ok ? { token: 't' } : { code: 'EMAIL_NOT_VERIFIED' }))
      }
      res.end('{}')
    })
  })
  await new Promise(r => server.listen(0, r))
  const url = `http://127.0.0.1:${server.address().port}`
  const code = await new Promise((resolve) => {
    const p = spawn(process.execPath, ['scripts/seed-review-login.mjs', '--url', url, '--email', 'review+x@example.com', '--password', 'new-pass', '--sqlite', file], { stdio: 'ignore', env: { ...process.env, SEED_REVIEW_TEST_HASH_PREFIX: 'test-hash:' } })
    p.on('exit', resolve)
  })
  server.close()
  assert.equal(code, 0)
  assert.ok(calls.filter(c => c === '/api/auth/sign-in/email').length >= 1)
  const after = new DatabaseSync(file)
  assert.equal(after.prepare('SELECT "emailVerified" AS v FROM "user"').get().v, 1)
  after.close()
})

// ── #3162: verify the reviewer address, without revoking on redeploy ──────────
import { markReviewerVerifiedSql } from './seed-review-login.mjs'

function vdb() {
  const d = new DatabaseSync(':memory:')
  d.exec(`
    CREATE TABLE "user" ("id" TEXT PRIMARY KEY, "email" TEXT, "emailVerified" INTEGER DEFAULT 0);
    CREATE TABLE "session" ("id" TEXT PRIMARY KEY, "userId" TEXT);
    INSERT INTO "user" VALUES ('u1','review+velo-pr5@example.com',0),('u2','other@example.com',0);
    INSERT INTO "session" VALUES ('s1','u1'),('s2','u2');
  `)
  return d
}
const count = (d, id) => d.prepare('SELECT count(*) c FROM "session" WHERE "id"=?').get(id).c
const verified = (d, id) => d.prepare('SELECT "emailVerified" v FROM "user" WHERE "id"=?').get(id).v

test('unverified reviewer: sessions dropped, then marked verified; others untouched', () => {
  const d = vdb()
  d.exec(markReviewerVerifiedSql('Review+velo-pr5@example.com'))
  assert.equal(count(d, 's1'), 0)
  assert.equal(verified(d, 'u1'), 1)
  assert.equal(count(d, 's2'), 1)
  assert.equal(verified(d, 'u2'), 0)
})

test('second run (redeploy) revokes nothing', () => {
  const d = vdb()
  d.exec(markReviewerVerifiedSql('review+velo-pr5@example.com'))
  d.exec(`INSERT INTO "session" VALUES ('s3','u1')`)
  d.exec(markReviewerVerifiedSql('review+velo-pr5@example.com'))
  assert.equal(count(d, 's3'), 1)
})

// ── #3474: exit 0 only when a working review login exists ──────────────────────────
import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import {
  isMissingSecretError, signUpDecision, SIGNUP_RETRY_DELAYS_MS, retryDelays
} from './seed-review-login.mjs'

const SCRIPT = fileURLToPath(new URL('./seed-review-login.mjs', import.meta.url))
const MISSING = { message: '[crouton/auth] BETTER_AUTH_SECRET is required. Set it in your environment variables.' }

async function runSeed(signUp, urlOverride) {
  let signUpCalls = 0
  const server = createServer((req, res) => {
    let status = 200
    let body = {}
    if (req.url === '/api/auth/sign-up/email') {
      signUpCalls++
      ;({ status, body } = signUp(signUpCalls))
    } else if (req.url === '/api/auth/organization/create') status = 403
    res.writeHead(status, { 'content-type': 'application/json' })
    res.end(JSON.stringify(body))
  })
  await new Promise(r => server.listen(0, '127.0.0.1', r))
  const url = urlOverride ?? `http://127.0.0.1:${server.address().port}`
  const code = await new Promise((resolve) => {
    execFile(process.execPath, [SCRIPT, '--url', url, '--email', 'review+t@example.com', '--password', 'pw'],
      { env: { ...process.env, SEED_SIGNUP_RETRY_DELAYS_MS: '0,0' } },
      err => resolve(err ? err.code : 0))
  })
  await new Promise(r => server.close(r))
  return { code, signUpCalls }
}

test('#3474 sign-up keeps failing with missing-secret error → non-zero', async () => {
  const r = await runSeed(() => ({ status: 500, body: MISSING }))
  assert.equal(r.code, 1)
  assert.equal(r.signUpCalls, 3)
})
test('#3474 sign-up succeeds → exit 0', async () => {
  const r = await runSeed(() => ({ status: 200, body: { token: 't', user: { id: 'u1' } } }))
  assert.equal(r.code, 0)
  assert.equal(r.signUpCalls, 1)
})
test('#3474 secret arrives during retries → exit 0', async () => {
  const r = await runSeed(n => n < 3 ? { status: 500, body: MISSING } : { status: 200, body: { token: 't', user: { id: 'u1' } } })
  assert.equal(r.code, 0)
  assert.equal(r.signUpCalls, 3)
})
test('#3474 other sign-up error is not retried → non-zero', async () => {
  const r = await runSeed(() => ({ status: 400, body: { code: 'INVALID_EMAIL' } }))
  assert.equal(r.code, 1)
  assert.equal(r.signUpCalls, 1)
})
test('#3474 unreachable Worker → non-zero', async () => {
  const s = createServer()
  await new Promise(r => s.listen(0, '127.0.0.1', r))
  const port = s.address().port
  await new Promise(r => s.close(r))
  const r = await runSeed(() => ({ status: 200, body: {} }), `http://127.0.0.1:${port}`)
  assert.equal(r.code, 1)
})
test('#3474 invalid --url → non-zero', async () => {
  const r = await runSeed(() => ({ status: 200, body: {} }), 'not-a-url')
  assert.equal(r.code, 1)
})

test('#3474 isMissingSecretError', () => {
  assert.ok(isMissingSecretError(MISSING.message))
  assert.ok(!isMissingSecretError('USER_ALREADY_EXISTS'))
  assert.ok(!isMissingSecretError('HTTP 500'))
})
test('#3474 signUpDecision', () => {
  const base = { ok: false, attempt: 1, maxAttempts: 7 }
  assert.equal(signUpDecision({ ...base, status: 500, code: MISSING.message }), 'retry')
  assert.equal(signUpDecision({ ...base, threw: true, code: 'fetch failed' }), 'retry')
  assert.equal(signUpDecision({ ...base, ok: true, status: 200 }), 'ok')
  assert.equal(signUpDecision({ ...base, status: 422, code: 'x' }), 'exists')
  assert.equal(signUpDecision({ ...base, status: 400, code: 'USER_ALREADY_EXISTS' }), 'exists')
  assert.equal(signUpDecision({ ...base, attempt: 7, status: 500, code: MISSING.message }), 'give-up')
  assert.equal(signUpDecision({ ...base, status: 400, code: 'INVALID_EMAIL' }), 'give-up')
})
test('#3474 retry delays', () => {
  assert.ok(SIGNUP_RETRY_DELAYS_MS.reduce((a, b) => a + b, 0) <= 60000)
  assert.deepEqual(retryDelays({ SEED_SIGNUP_RETRY_DELAYS_MS: '0,0' }), [0, 0])
  assert.equal(retryDelays({}), SIGNUP_RETRY_DELAYS_MS)
  assert.equal(retryDelays({ SEED_SIGNUP_RETRY_DELAYS_MS: 'x' }), SIGNUP_RETRY_DELAYS_MS)
})
