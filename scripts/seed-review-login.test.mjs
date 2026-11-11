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
import { createServer } from 'node:http'
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
  const r = await runSeed(() => ({ status: 200, body: { user: { id: 'u1' } } }))
  assert.equal(r.code, 0)
  assert.equal(r.signUpCalls, 1)
})
test('#3474 secret arrives during retries → exit 0', async () => {
  const r = await runSeed(n => n < 3 ? { status: 500, body: MISSING } : { status: 200, body: { user: { id: 'u1' } } })
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

// ── #3751: no login advertised when the seeded team has no demo data ─────────────────
// The real CLI, run against a real SQLite file holding the seeded team, with a stand-in
// for the Worker's auth routes (the only part that needs a deployed app). This is the
// same `--require-data` path the deploy step runs; only the transport differs (--sqlite
// instead of --db, the same SQL).
import { mkdtempSync, writeFileSync, chmodSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { teamDataCountSql, missingTeamData } from './seed-review-login.mjs'

const ORG = 'seed:org:test1'

function teamDb({ locations, bookings }) {
  const dir = mkdtempSync(join(tmpdir(), 'seed-3751-'))
  const file = join(dir, 'sqlite.db')
  const d = new DatabaseSync(file)
  d.exec(`
    CREATE TABLE "user" ("id" TEXT PRIMARY KEY, "email" TEXT, "emailVerified" INTEGER DEFAULT 0);
    CREATE TABLE "session" ("id" TEXT PRIMARY KEY, "userId" TEXT);
    -- #3141: an existing review user now has its password reset before sign-in
    CREATE TABLE "account" ("id" TEXT PRIMARY KEY, "userId" TEXT, "providerId" TEXT, "password" TEXT);
    INSERT INTO "account" VALUES ('a1', 'u1', 'credential', 'hash(old)');
    CREATE TABLE "member" ("id" TEXT PRIMARY KEY, "userId" TEXT, "organizationId" TEXT, "role" TEXT, "createdAt" INTEGER);
    CREATE TABLE "bookings_locations" ("id" TEXT PRIMARY KEY, "teamId" TEXT NOT NULL);
    CREATE TABLE "bookings_bookings" ("id" TEXT PRIMARY KEY, "teamId" TEXT NOT NULL);
    INSERT INTO "user" VALUES ('u1', 'review+t@example.com', 0);
    -- another team's rows must not count for test1
    INSERT INTO "bookings_locations" VALUES ('other-l', 'seed:org:other');
    INSERT INTO "bookings_bookings" VALUES ('other-b', 'seed:org:other');
  `)
  for (let i = 0; i < locations; i++) d.exec(`INSERT INTO "bookings_locations" VALUES ('l${i}', '${ORG}')`)
  for (let i = 0; i < bookings; i++) d.exec(`INSERT INTO "bookings_bookings" VALUES ('b${i}', '${ORG}')`)
  d.close()
  // The membership prune shells out to wrangler; a failing `npx` keeps the test offline.
  writeFileSync(join(dir, 'npx'), '#!/bin/sh\nexit 1\n')
  chmodSync(join(dir, 'npx'), 0o755)
  return { file, bin: dir }
}

async function runWithData(db, requireData) {
  const server = createServer((req, res) => {
    let body = {}
    if (req.url === '/api/auth/get-session') body = { user: { id: 'u1' }, session: {} }
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify(body))
  })
  await new Promise(r => server.listen(0, '127.0.0.1', r))
  const url = `http://127.0.0.1:${server.address().port}`
  const args = [SCRIPT, '--url', url, '--email', 'review+t@example.com', '--password', 'pw',
    '--seed-team', 'test1', '--sqlite', db.file]
  if (requireData) args.push('--require-data', requireData)
  const result = await new Promise((resolve) => {
    execFile(process.execPath, args,
      { env: { ...process.env, PATH: `${db.bin}:${process.env.PATH}`, SEED_SIGNUP_RETRY_DELAYS_MS: '0,0' } },
      (err, stdout, stderr) => resolve({ code: err ? err.code : 0, out: `${stdout}${stderr}` }))
  })
  await new Promise(r => server.close(r))
  return result
}

const BOOKING_TABLES = 'bookings_locations,bookings_bookings'

test('#3751 seeded team has locations and bookings → exit 0, counts logged', async () => {
  const r = await runWithData(teamDb({ locations: 2, bookings: 3 }), BOOKING_TABLES)
  assert.equal(r.code, 0, r.out)
  assert.match(r.out, /team seed:org:test1 data: bookings_locations=2, bookings_bookings=3/)
})

test('#3751 seed never reached the team (no rows) → non-zero, no login', async () => {
  const r = await runWithData(teamDb({ locations: 0, bookings: 0 }), BOOKING_TABLES)
  assert.equal(r.code, 1, r.out)
  assert.match(r.out, /bookings_locations=0, bookings_bookings=0/)
  assert.match(r.out, /no rows in bookings_locations, bookings_bookings/)
})

test('#3751 locations but no bookings → non-zero', async () => {
  const r = await runWithData(teamDb({ locations: 1, bookings: 0 }), BOOKING_TABLES)
  assert.equal(r.code, 1, r.out)
  assert.match(r.out, /no rows in bookings_bookings/)
})

test('#3751 a table the seed never created counts as missing → non-zero', async () => {
  const r = await runWithData(teamDb({ locations: 1, bookings: 1 }), 'bookings_locations,bookings_missing')
  assert.equal(r.code, 1, r.out)
  assert.match(r.out, /bookings_missing=error/)
})

test('#3751 no --require-data → an empty team still logs in (other apps unchanged)', async () => {
  const r = await runWithData(teamDb({ locations: 0, bookings: 0 }), '')
  assert.equal(r.code, 0, r.out)
  assert.doesNotMatch(r.out, /data:/)
})

test('#3751 teamDataCountSql refuses a non-identifier table name', () => {
  assert.throws(() => teamDataCountSql('x"; DROP TABLE user; --', ORG), /invalid table name/)
  assert.match(teamDataCountSql('bookings_locations', "a'b"), /"teamId"='a''b'/)
})

test('#3751 missingTeamData: zero and failed counts are missing', () => {
  assert.deepEqual(missingTeamData({ a: 1, b: 0, c: null }), ['b', 'c'])
  assert.deepEqual(missingTeamData({ a: 4 }), [])
})

// The deploy step must pass the app's `reviewLogin.requireData` through, and booking-demo
// must name both bookings tables — else the check above never runs where it matters.
test('#3751 deploy-app.yml passes reviewLogin.requireData to the seed; booking-demo sets it', () => {
  const wf = readFileSync(new URL('../.github/workflows/deploy-app.yml', import.meta.url), 'utf8')
  assert.match(wf, /\.reviewLogin\.requireData \/\/ \[\]\) \| join\(","\)/)
  const seedCall = wf.match(/if node scripts\/seed-review-login\.mjs[^\n]*\\\n[^\n]*/)?.[0] || ''
  assert.match(seedCall, /"\$\{REQUIRE_ARGS\[@\]\}"; then/)
  const cfg = JSON.parse(readFileSync(new URL('../pocs/booking-demo/deploy.config.json', import.meta.url), 'utf8'))
  assert.deepEqual(cfg.reviewLogin.requireData, ['bookings_locations', 'bookings_bookings'])
})

// ── #3533: member upsert quote escaping ──
// The --seed-team member upsert used to be built inline in main(), so no test could
// reach it. Runs the real SQL against an in-memory SQLite db.
import { memberUpsertSql } from './seed-review-login.mjs'

function memberDb() {
  const d = new DatabaseSync(':memory:')
  d.exec(`
    CREATE TABLE "member" ("id" TEXT PRIMARY KEY, "userId" TEXT, "organizationId" TEXT, "role" TEXT, "createdAt" INTEGER);
    INSERT INTO "member" VALUES ('keep', 'u2', 'seed:org:test1', 'owner', 1);
  `)
  return d
}

test('#3533 memberUpsertSql: quotes in ids are stored literally and cannot break out', () => {
  const d = memberDb()
  const userId = 'u\'); DELETE FROM "member"; --'
  d.exec(memberUpsertSql({ memberId: "m'1", userId, orgId: "o'x", createdAt: 1 }))
  const row = d.prepare('SELECT * FROM "member" WHERE "id" = ?').get("m'1")
  assert.equal(row.userId, userId)
  assert.equal(row.organizationId, "o'x")
  assert.equal(row.role, 'owner')
  assert.ok(d.prepare('SELECT 1 FROM "member" WHERE "id" = ?').get('keep'), 'bystander row survives')
  assert.equal(d.prepare('SELECT count(*) AS n FROM "member"').get().n, 2)
})

// ── #3141 (R4): look the account up first — the review login survives e-mail verification ──
// In an app with crouton-email, sign-up of an existing address returns 200 with no
// session (not 422), and a new account gets no session until it is verified. These run
// the real script against a real sqlite file and a fake Worker that enforces both rules.
import { reviewerExistsSql } from './seed-review-login.mjs'

const R4_EMAIL = 'review+t@example.com'

function r4Db({ withUser }) {
  const dir = mkdtempSync(join(tmpdir(), 'seed-3141-'))
  const file = join(dir, 'sqlite.db')
  const d = new DatabaseSync(file)
  d.exec(`
    CREATE TABLE "user" ("id" TEXT PRIMARY KEY, "email" TEXT, "emailVerified" INTEGER DEFAULT 0);
    CREATE TABLE "session" ("id" TEXT PRIMARY KEY, "userId" TEXT);
    CREATE TABLE "account" ("id" TEXT PRIMARY KEY, "userId" TEXT, "providerId" TEXT, "password" TEXT);
  `)
  if (withUser) {
    d.exec(`INSERT INTO "user" VALUES ('u1', '${R4_EMAIL}', 0);
      INSERT INTO "account" VALUES ('a1', 'u1', 'credential', 'hash-of-an-old-password');`)
  }
  d.close()
  return file
}

const row = (file, sql) => {
  const d = new DatabaseSync(file)
  try { return d.prepare(sql).get() } finally { d.close() }
}

async function runR4(file, handle) {
  const calls = []
  const server = createServer(async (req, res) => {
    calls.push({ url: req.url, cookie: req.headers.cookie || '' })
    const { status = 200, body = {}, headers = {} } = (await handle(req.url)) || {}
    res.writeHead(status, { 'content-type': 'application/json', ...headers })
    res.end(JSON.stringify(body))
  })
  await new Promise(r => server.listen(0, '127.0.0.1', r))
  const url = `http://127.0.0.1:${server.address().port}`
  const result = await new Promise((resolve) => {
    execFile(process.execPath, [SCRIPT, '--url', url, '--email', R4_EMAIL, '--password', 'pw', '--sqlite', file],
      { env: { ...process.env, SEED_SIGNUP_RETRY_DELAYS_MS: '0,0' } },
      (err, stdout, stderr) => resolve({ code: err ? err.code : 0, out: `${stdout}${stderr}` }))
  })
  await new Promise(r => server.close(r))
  return { ...result, calls }
}

const SESSION_COOKIE = { 'set-cookie': 'better-auth.session_token=tok; Path=/; HttpOnly' }

test('R4 existing review account whose password changed still gets a working login', async () => {
  const req = createRequire(new URL('../packages/crouton-auth/package.json', import.meta.url))
  const { verifyPassword } = await import(req.resolve('better-auth/crypto'))
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

test('R4 new account in an app that requires verification', async () => {
  const file = r4Db({ withUser: false })
  const r = await runR4(file, async (path) => {
    if (path === '/api/auth/sign-up/email') {
      const d = new DatabaseSync(file)
      d.exec(`INSERT INTO "user" VALUES ('u9', '${R4_EMAIL}', 0)`)
      d.close()
      return { body: { token: null, user: { id: 'u9' } } } // no cookie: verification required
    }
    if (path === '/api/auth/sign-in/email') {
      const { v } = row(file, `SELECT "emailVerified" AS v FROM "user" WHERE "id" = 'u9'`)
      return v ? { body: { token: 'tok' }, headers: SESSION_COOKIE } : { status: 403, body: { code: 'EMAIL_NOT_VERIFIED' } }
    }
    if (path === '/api/auth/get-session') return { body: { user: { id: 'u9' }, session: {} } }
    if (path === '/api/auth/organization/create') return { status: 403 }
  })
  assert.equal(r.code, 0, r.out)
  assert.equal(row(file, `SELECT "emailVerified" AS v FROM "user" WHERE "id" = 'u9'`).v, 1)
  const session = r.calls.find(c => c.url === '/api/auth/get-session')
  assert.ok(session, 'get-session was called')
  assert.match(session.cookie, /better-auth\.session_token=tok/)
})

test('R4 reviewerExistsSql: matches regardless of letter case; quotes cannot break out', () => {
  const d = new DatabaseSync(':memory:')
  d.exec(`CREATE TABLE "user" ("id" TEXT PRIMARY KEY, "email" TEXT);
    INSERT INTO "user" VALUES ('u1', 'review+velo-main@example.com');`)
  assert.equal(d.prepare(reviewerExistsSql('Review+Velo-Main@Example.com')).get().n, 1)
  assert.equal(d.prepare(reviewerExistsSql('nobody@example.com')).get().n, 0)
  assert.equal(d.prepare(reviewerExistsSql("x' OR '1'='1")).get().n, 0)
})

test('#3533 memberUpsertSql: re-running updates the same row (idempotent)', () => {
  const d = memberDb()
  d.exec(memberUpsertSql({ memberId: 'm1', userId: 'first', orgId: 'seed:org:test1', createdAt: 100 }))
  d.exec(memberUpsertSql({ memberId: 'm1', userId: 'second', orgId: 'seed:org:test1', createdAt: 200 }))
  const rows = d.prepare('SELECT * FROM "member" WHERE "id" = ?').all('m1')
  assert.equal(rows.length, 1)
  assert.equal(rows[0].userId, 'second')
  assert.equal(rows[0].createdAt, 100)
})
