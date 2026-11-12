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

// ── #3340: an invite-only app refuses public sign-up → create the login via SQL ───────
// The real CLI against a real SQLite file, with a stand-in for the Worker's auth routes
// that answers sign-up the way crouton-auth's invite-only gate does.
import { createReviewAccountSql, scryptHashPassword } from './seed-review-login.mjs'

const INVITE_ONLY = { status: 403, body: { message: 'Sign-up is by invitation only', code: 'SIGNUP_INVITE_ONLY' } }

function authDb() {
  const dir = mkdtempSync(join(tmpdir(), 'seed-3340-'))
  const file = join(dir, 'sqlite.db')
  const d = new DatabaseSync(file)
  d.exec(`
    CREATE TABLE "user" ("id" TEXT PRIMARY KEY, "name" TEXT NOT NULL, "email" TEXT NOT NULL UNIQUE,
      "emailVerified" INTEGER NOT NULL DEFAULT 0, "createdAt" INTEGER NOT NULL, "updatedAt" INTEGER NOT NULL,
      "superAdmin" INTEGER NOT NULL DEFAULT 0, "banned" INTEGER NOT NULL DEFAULT 0, "role" TEXT DEFAULT 'user');
    CREATE TABLE "account" ("id" TEXT PRIMARY KEY, "userId" TEXT NOT NULL, "accountId" TEXT NOT NULL,
      "providerId" TEXT NOT NULL, "password" TEXT, "createdAt" INTEGER NOT NULL, "updatedAt" INTEGER NOT NULL);
    CREATE TABLE "session" ("id" TEXT PRIMARY KEY, "userId" TEXT);
  `)
  d.close()
  return file
}

async function runInviteOnly(extraArgs) {
  const seen = []
  const server = createServer((req, res) => {
    seen.push(req.url)
    let status = 200
    let body = {}
    if (req.url === '/api/auth/sign-up/email') ({ status, body } = INVITE_ONLY)
    else if (req.url === '/api/auth/get-session') body = { user: { id: 'whatever' }, session: { activeOrganizationId: 'o1' } }
    res.writeHead(status, { 'content-type': 'application/json' })
    res.end(JSON.stringify(body))
  })
  await new Promise(r => server.listen(0, '127.0.0.1', r))
  const url = `http://127.0.0.1:${server.address().port}`
  const result = await new Promise((resolve) => {
    execFile(process.execPath, [SCRIPT, '--url', url, '--email', 'Review+velo-pr9@example.com', '--password', 'pw', ...extraArgs],
      { env: { ...process.env, SEED_SIGNUP_RETRY_DELAYS_MS: '0,0' } },
      (err, stdout, stderr) => resolve({ code: err ? err.code : 0, out: `${stdout}${stderr}` }))
  })
  await new Promise(r => server.close(r))
  return { ...result, seen }
}

const rows = (file, sql) => {
  const d = new DatabaseSync(file)
  try { return d.prepare(sql).all() } finally { d.close() }
}

test('#3340 signUpDecision: 403 SIGNUP_INVITE_ONLY → invite-only (a plain 403 is not)', () => {
  const base = { ok: false, attempt: 1, maxAttempts: 7 }
  assert.equal(signUpDecision({ ...base, status: 403, code: 'SIGNUP_INVITE_ONLY' }), 'invite-only')
  assert.equal(signUpDecision({ ...base, status: 403, code: 'FORBIDDEN' }), 'give-up')
})

test('#3340 invite-only app + --sqlite → user + credential account created, signed in, exit 0; rerun adds nothing', async () => {
  const file = authDb()
  const r = await runInviteOnly(['--sqlite', file])
  assert.equal(r.code, 0, r.out)
  assert.ok(r.seen.includes('/api/auth/sign-in/email'), 'signs in after creating the account')
  const users = rows(file, 'SELECT * FROM "user"')
  assert.equal(users.length, 1)
  assert.equal(users[0].email, 'review+velo-pr9@example.com')
  assert.equal(users[0].emailVerified, 1) // marked verified by the #3162 step after sign-in
  assert.ok(users[0].createdAt < 1e11, 'createdAt is unix seconds')
  const accounts = rows(file, 'SELECT * FROM "account"')
  assert.equal(accounts.length, 1)
  assert.equal(accounts[0].providerId, 'credential')
  assert.equal(accounts[0].userId, users[0].id)
  assert.equal(accounts[0].accountId, users[0].id)

  const again = await runInviteOnly(['--sqlite', file])
  assert.equal(again.code, 0, again.out)
  assert.equal(rows(file, 'SELECT * FROM "user"').length, 1)
  assert.equal(rows(file, 'SELECT * FROM "account"').length, 1)
})

test('#3340 invite-only app without --db/--sqlite → non-zero, no login', async () => {
  const r = await runInviteOnly([])
  assert.equal(r.code, 1, r.out)
  assert.match(r.out, /invite-only app: pass --db/)
})

test('#3340 createReviewAccountSql: quotes in the email, name or hash cannot break out', async () => {
  const file = authDb()
  const d = new DatabaseSync(file)
  d.exec(`INSERT INTO "user" ("id","name","email","createdAt","updatedAt") VALUES ('u2','Other','other@example.com',1,1)`)
  d.exec(await createReviewAccountSql("x' OR '1'='1@example.com", "O'Brien", "it's", async pw => `hash(${pw})`))
  const users = d.prepare('SELECT * FROM "user" ORDER BY "id" = \'u2\'').all()
  assert.equal(users.length, 2)
  assert.equal(users[0].email, "x' or '1'='1@example.com")
  assert.equal(users[0].name, "O'Brien")
  const accounts = d.prepare('SELECT * FROM "account"').all()
  assert.equal(accounts.length, 1)
  assert.equal(accounts[0].password, "hash(it's)")
  assert.equal(accounts[0].userId, users[0].id)
  d.close()
})

test('#3340 createReviewAccountSql: the default hasher is better-auth\'s, so sign-in verifies it', async (t) => {
  let verifyPassword
  try {
    const req = createRequire(new URL('../packages/crouton-auth/package.json', import.meta.url))
    ;({ verifyPassword } = await import(req.resolve('better-auth/crypto')))
  } catch {
    t.skip('better-auth not installed in this checkout')
    return
  }
  const file = authDb()
  const d = new DatabaseSync(file)
  d.exec(await createReviewAccountSql('review+velo-pr9@example.com', 'Review Tester', 'new-secret'))
  const { password } = d.prepare('SELECT "password" FROM "account"').get()
  d.close()
  assert.equal(await verifyPassword({ hash: password, password: 'new-secret' }), true)
})

// CI's Node-only job has no `pnpm install`, so the seed falls back to its own scrypt
// hash there — it must be one better-auth's sign-in accepts.
test('#3340 scryptHashPassword (no-better-auth fallback) is verified by better-auth', async (t) => {
  const hash = await scryptHashPassword('new-secret')
  assert.match(hash, /^[0-9a-f]{32}:[0-9a-f]{128}$/)
  let verifyPassword
  try {
    const req = createRequire(new URL('../packages/crouton-auth/package.json', import.meta.url))
    ;({ verifyPassword } = await import(req.resolve('better-auth/crypto')))
  } catch {
    t.skip('better-auth not installed in this checkout')
    return
  }
  assert.equal(await verifyPassword({ hash, password: 'new-secret' }), true)
  assert.equal(await verifyPassword({ hash, password: 'wrong' }), false)
})
