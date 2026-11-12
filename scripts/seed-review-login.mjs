#!/usr/bin/env node
/**
 * seed-review-login.mjs — seed a throwaway, loginable test account on a fresh
 * preview deploy so a reviewer can open the URL and be inside the app in one step
 * (#608). Drives the app's own HTTP auth; SQL only where there is no HTTP path (team
 * membership, a rotated password, and the account itself on an invite-only app,
 * #3340). Passwords are always hashed with better-auth's own helper.
 *
 *   node scripts/seed-review-login.mjs --url https://app-staging.workers.dev \
 *     --email review+app-pr12@example.com --password <pw> [--team "Review Team"] \
 *     [--seed-team test1 --db app-staging-db]
 *
 * Flow (all via the public auth routes the browser uses):
 *   0. With --db/--sqlite (both callers always pass one), LOOK THE ACCOUNT UP FIRST
 *      (#3141). An app with crouton-email requires a verified e-mail, so sign-up of
 *      an existing address no longer says "already exists" (it returns 200 with no
 *      session) and a new account gets no session until it is verified.
 *      - Existing account (redeploy): POST /sign-in/email with the given password.
 *        A 200 proves the account is ours — reused as-is (step 4 verifies it). If it
 *        is refused (old password, or not verified yet): reset its password to the
 *        given one (hashed with better-auth's own helper, #2358), mark it verified
 *        (dropping any stranger's unverified sessions first, #3162), then sign in
 *        again — it must return 200. Sign-up is skipped.
 *      - New account: step 1. If sign-up returns no session token (verification
 *        required), the seed just created the account with its own password, so it
 *        marks it verified and signs in (must return 200).
 *   1. POST /api/auth/sign-up/email   (autoSignIn → session cookie). Without a db
 *      flag (today's flow): an existing user (redeploy) returns USER_ALREADY_EXISTS
 *      → sign in with the given password; if that fails the account holds an OLD
 *      password and, with --db/--sqlite, it is reset and sign-in is retried.
 *   1b. sign-up refused SIGNUP_INVITE_ONLY (the app sets `croutonAuth.signup:
 *      'invite'`, #3340) → with --db/--sqlite create the user + credential rows
 *      directly (idempotent), mark the address verified BEFORE signing in (an
 *      invite-only app with crouton-email refuses an unverified sign-in, #3141),
 *      then sign in and continue like an existing user.
 *      Without --db/--sqlite it exits 1 — there is no HTTP path to an account.
 *   2. GET  /api/auth/get-session     → capture the review user's id + whether
 *      the session already has an active organization.
 *   3a. --seed-team given (#832): attach the review user to the SEEDED demo org
 *      (`seedOrgId(slug)`, e.g. test1 → `seed:org:test1`) so the advertised login
 *      lands in the team the content seed populated — instead of a fresh, EMPTY
 *      org. The membership has no HTTP join path (no invite), so it's an
 *      idempotent `member` upsert via `wrangler d1 execute <db> --remote`, then
 *      POST /set-active. Needs Cloudflare creds in the env (the deploy step has
 *      them) — staging only, so production is untouched.
 *   3b. otherwise: if there's no active organization (the allowCreate pattern
 *      that drops you at a "create team" wall), POST /api/auth/organization/create
 *      + /set-active so the reviewer lands INSIDE the app. Apps with
 *      autoCreateOnSignup / defaultTeamSlug already have an active org → skipped.
 *
 * Exit 0 <=> a working review login exists (#1369, #2358, #3474). Anything else is
 * non-zero: usage error (2); an invalid --url, an unreachable Worker, a sign-up that
 * still fails after retries (the fresh Worker may not see its auth secret for a few
 * seconds), or an existing account that refuses the password (1). The caller only
 * advertises a login on exit 0.
 *
 * Staging only — the caller (deploy-app.yml) gates this to environment != production.
 */

import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { randomBytes, scrypt } from 'node:crypto'
import { pathToFileURL } from 'node:url'

function parseArgs(argv) {
  const out = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--url') out.url = argv[++i]
    else if (a === '--email') out.email = argv[++i]
    else if (a === '--password') out.password = argv[++i]
    else if (a === '--name') out.name = argv[++i]
    else if (a === '--team') out.team = argv[++i]
    else if (a === '--seed-team') out.seedTeam = argv[++i]
    else if (a === '--db') out.db = argv[++i]
    else if (a === '--sqlite') out.sqlite = argv[++i]
    else if (a === '--require-data') out.requireData = String(argv[++i] || '').split(',').map(s => s.trim()).filter(Boolean)
  }
  return out
}

/**
 * #3751: the SQL that counts a seeded team's rows in one table. Crouton collection
 * tables scope rows by a `teamId` column. The table name is interpolated, so it must
 * be a plain identifier — anything else throws rather than reaching the database.
 */
export function teamDataCountSql(table, orgId) {
  if (!/^[A-Za-z0-9_]+$/.test(String(table))) throw new Error(`invalid table name: ${table}`)
  return `SELECT COUNT(*) AS "n" FROM "${table}" WHERE "teamId"=${sqlStr(orgId)};`
}

/**
 * #3751: given `{ table: count | null }` (null = the query failed), the tables that
 * leave the review login without data. Empty array ⇔ the team has everything.
 */
export function missingTeamData(counts) {
  return Object.entries(counts).filter(([, n]) => !(Number(n) > 0)).map(([t]) => t)
}

/** Run one read query and return its first row's `n` (same two transports as execSeedSql). */
function querySeedCount(args, sql) {
  if (args.sqlite) {
    const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite')
    const db = new DatabaseSync(args.sqlite)
    try { return Number(db.prepare(sql).get()?.n ?? 0) } finally { db.close() }
  }
  const out = execFileSync('npx', ['wrangler', 'd1', 'execute', args.db, '--remote', `--command=${sql}`, '--json', '--yes'], {
    stdio: ['ignore', 'pipe', 'inherit'],
    env: process.env
  }).toString()
  // wrangler --json prints `[{ results: [{ n }], success, meta }]`.
  const parsed = JSON.parse(out.slice(out.indexOf('[')))
  return Number(parsed?.[0]?.results?.[0]?.n ?? 0)
}

/**
 * Run the seeded-team member upsert. Two transports for the SAME statement:
 * `--db` → remote D1 via wrangler (the deploy path, #832); `--sqlite` → the local
 * `.data/db/sqlite.db` file `nuxt dev` reads (the `pnpm preview` path, #1777).
 * better-sqlite3 is native, so it's required lazily — the remote path never loads it.
 */
function execSeedSql(args, sql) {
  if (args.sqlite) {
    // node:sqlite (built in since Node 22) over better-sqlite3 on purpose: this
    // script runs from the repo ROOT, where better-sqlite3 does not resolve — it
    // belongs to crouton-cli. Requiring it here failed silently into the
    // "fresh empty team" fallback, which is the very bug #832 fixed. Keep
    // better-sqlite3 as a fallback for a runtime without node:sqlite.
    let db
    try {
      const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite')
      db = new DatabaseSync(args.sqlite)
    } catch {
      const Database = createRequire(import.meta.url)('better-sqlite3')
      db = new Database(args.sqlite)
    }
    try { db.exec(sql) } finally { db.close() }
    return
  }
  // execFileSync (no shell) passes the SQL as one argv entry — quotes/JSON need no
  // escaping. wrangler resolves the D1 db by name account-wide, so repo-root cwd is
  // fine. CF creds come from the deploy step's env.
  execFileSync('npx', ['wrangler', 'd1', 'execute', args.db, '--remote', `--command=${sql}`, '--yes'], {
    stdio: 'inherit',
    env: process.env
  })
}

/**
 * Build the one-click review-login URL: the login form reads `?email=`/`?password=`
 * and prefills without auto-submitting (crouton-auth `auth-modal-router.client.ts`,
 * apply fixed in #1153). URLSearchParams is load-bearing — the `+` in
 * `review+<app>-<key>@example.com` decodes as a SPACE unencoded, so a hand-built
 * link logs in as the wrong address.
 */
export const SIGNUP_RETRY_DELAYS_MS = [2000, 4000, 8000, 15000, 15000, 15000]

export function isMissingSecretError(code) {
  return /BETTER_AUTH_SECRET is required/i.test(String(code ?? ''))
}

/** 'ok' | 'exists' | 'invite-only' | 'retry' | 'give-up' for one sign-up attempt. */
export function signUpDecision({ ok, status, code, threw, attempt, maxAttempts }) {
  if (ok) return 'ok'
  // #3340: an invite-only app refuses public sign-up for an uninvited email.
  if (!threw && status === 403 && /SIGNUP_INVITE_ONLY/.test(String(code ?? ''))) return 'invite-only'
  if (!threw && (status === 422 || /USER_ALREADY_EXISTS|already exists/i.test(String(code ?? '')))) return 'exists'
  if ((threw || isMissingSecretError(code)) && attempt < maxAttempts) return 'retry'
  return 'give-up'
}

export function retryDelays(env = process.env) {
  const raw = env.SEED_SIGNUP_RETRY_DELAYS_MS
  if (raw) {
    const parts = raw.split(',').map(x => x.trim())
    if (parts.every(x => /^\d+$/.test(x))) return parts.map(Number)
  }
  return SIGNUP_RETRY_DELAYS_MS
}

export function buildLoginUrl({ url, email, password, landing }) {
  const q = new URLSearchParams({ email, password })
  if (landing) q.set('redirect', landing)
  return `${new URL(url).origin}/auth/login?${q}`
}

/**
 * Stable, slug-safe seed id under the `seed:` namespace — inlined here (this is a
 * plain-node script, can't import the TS `@fyit/crouton-core/shared/seed`). MUST
 * stay in lockstep with `crouton-core/shared/seed/id.ts` so ids line up with the
 * content seed (`seedOrgId('test1') === 'seed:org:test1'`).
 */
function seedId(...parts) {
  return [
    'seed',
    ...parts.map(p =>
      String(p).trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    )
  ].join(':')
}
const seedOrgId = slug => seedId('org', slug)

/** Single-quote-escape a value for an inline SQLite string literal. */
function sqlStr(v) {
  return `'${String(v).replace(/'/g, "''")}'`
}

/**
 * better-auth's own password hasher. This script runs from the repo ROOT, where
 * better-auth doesn't resolve (pnpm keeps it under the packages that depend on it),
 * so resolve it from crouton-auth — the package every crouton app's auth comes from.
 */
async function loadHashPassword() {
  try {
    const req = createRequire(new URL('../packages/crouton-auth/package.json', import.meta.url))
    const { hashPassword } = await import(pathToFileURL(req.resolve('better-auth/crypto')).href)
    return hashPassword
  } catch {
    // No `pnpm install` in this checkout (e.g. CI's Node-only job, #3340): use the
    // same scrypt hash better-auth's Node build makes, so sign-in still verifies it.
    return scryptHashPassword
  }
}

/** better-auth's Node password hash (`@better-auth/utils/password`): `<salt hex>:<key hex>`. */
export function scryptHashPassword(password) {
  const N = 16384, r = 16, p = 1
  const salt = randomBytes(16).toString('hex')
  return new Promise((resolve, reject) => {
    scrypt(String(password).normalize('NFKC'), salt, 64, { N, r, p, maxmem: 128 * N * r * 2 },
      (err, key) => err ? reject(err) : resolve(`${salt}:${key.toString('hex')}`))
  })
}

/**
 * SQL that sets the credential password of the user with `email` to `password`
 * (hashed exactly like a signup, so login verifies it). Touches nothing else —
 * the account, its team membership and anything it created stay as they are (#2358).
 */
export async function resetPasswordSql(email, password, hashPassword) {
  const hash = await (hashPassword || await loadHashPassword())(password)
  return `UPDATE "account" SET "password" = ${sqlStr(hash)} ` +
    `WHERE "providerId" = 'credential' AND "userId" = (SELECT "id" FROM "user" WHERE "email" = ${sqlStr(email)});`
}

/**
 * #3141: SQL that counts the accounts holding `email` (case-insensitive, like
 * better-auth, which stores addresses lower-cased). Read through `querySeedCount`.
 */
export function reviewerExistsSql(email) {
  return `SELECT COUNT(*) AS "n" FROM "user" WHERE lower("email") = ${sqlStr(String(email).toLowerCase())};`
}

/**
 * SQL that creates the review account directly (#3340) — for an invite-only app,
 * where public sign-up is refused for an uninvited email. Inserts a `user` row and
 * its `credential` `account` row (password hashed with better-auth's own helper, so
 * sign-in verifies it). Idempotent: both inserts are `WHERE NOT EXISTS`, so a second
 * run adds nothing. Timestamps are unix SECONDS (drizzle `mode: 'timestamp'`).
 * The address is left unverified — the seed runs markReviewerVerifiedSql right after
 * it, before signing in (an app with crouton-email refuses an unverified sign-in, #3141).
 */
export async function createReviewAccountSql(email, name, password, hashPassword) {
  const hash = await (hashPassword || await loadHashPassword())(password)
  const e = sqlStr(String(email).toLowerCase())
  const now = Math.floor(Date.now() / 1000)
  const userId = sqlStr(crypto.randomUUID())
  const accountId = sqlStr(crypto.randomUUID())
  return `INSERT INTO "user" ("id","name","email","emailVerified","createdAt","updatedAt") ` +
    `SELECT ${userId},${sqlStr(name)},${e},0,${now},${now} ` +
    `WHERE NOT EXISTS (SELECT 1 FROM "user" WHERE lower("email") = ${e}); ` +
    `INSERT INTO "account" ("id","userId","accountId","providerId","password","createdAt","updatedAt") ` +
    `SELECT ${accountId},u."id",u."id",'credential',${sqlStr(hash)},${now},${now} FROM "user" u ` +
    `WHERE lower(u."email") = ${e} AND NOT EXISTS ` +
    `(SELECT 1 FROM "account" a WHERE a."userId" = u."id" AND a."providerId" = 'credential');`
}

/**
 * SQL that closes the "stranger pre-registered the predictable review address" hole
 * (#3162). The feedback guard only trusts a VERIFIED email, and sign-up leaves it
 * unverified. Run it ONLY after the seed proved the account holds the seed password
 * (sign-up succeeded, or sign-in with the seed password worked) and after the seed's
 * own API calls. (a) an unverified account's sessions are dropped (could be a
 * stranger's); (b) it is then marked verified. On redeploy the row is already
 * verified, so (a) matches nothing — no session is revoked.
 */
export function markReviewerVerifiedSql(email) {
  const e = sqlStr(String(email).toLowerCase())
  return `DELETE FROM "session" WHERE "userId" IN ` +
    `(SELECT "id" FROM "user" WHERE lower("email") = ${e} AND "emailVerified" = 0); ` +
    `UPDATE "user" SET "emailVerified" = 1 WHERE lower("email") = ${e};`
}

/**
 * #3141: SQL that deletes EVERY session of the account holding `email`, verified or
 * not. Run only in the reset branch (an existing account refused the seed password),
 * before `resetPasswordSql`: the `verify_existing_users` backfill marks every
 * account verified, so `markReviewerVerifiedSql` drops nothing there, and a stranger who
 * pre-registered the review address would stay signed in to an account the feedback
 * guard trusts. The review address belongs to the deploy; the stranger loses access.
 */
export function deleteReviewerSessionsSql(email) {
  return `DELETE FROM "session" WHERE "userId" IN ` +
    `(SELECT "id" FROM "user" WHERE lower("email") = ${sqlStr(String(email).toLowerCase())});`
}

function warn(msg) {
  console.warn(`[seed-review-login] ⚠ ${msg}`)
}
function info(msg) {
  console.log(`[seed-review-login] ${msg}`)
}

/** Collect Set-Cookie headers into a single Cookie request header value. */
function mergeCookies(existing, res) {
  const jar = new Map()
  for (const [k, v] of existing) jar.set(k, v)
  // Node's fetch exposes multiple Set-Cookie via getSetCookie() (undici).
  const setCookies = typeof res.headers.getSetCookie === 'function'
    ? res.headers.getSetCookie()
    : (res.headers.get('set-cookie') ? [res.headers.get('set-cookie')] : [])
  for (const sc of setCookies) {
    const pair = sc.split(';')[0]
    const eq = pair.indexOf('=')
    if (eq > 0) jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim())
  }
  return jar
}

function cookieHeader(jar) {
  return Array.from(jar.entries()).map(([k, v]) => `${k}=${v}`).join('; ')
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const { url, email, password } = args
  if (!url || !email || !password) {
    console.error('Usage: seed-review-login.mjs --url <url> --email <e> --password <p> [--name <n>] [--team <t>] [--seed-team <slug> (--db <d1> | --sqlite <path>) [--require-data <table,table>]]')
    process.exit(2)
  }

  let origin
  try {
    origin = new URL(url).origin
  } catch {
    warn(`invalid --url "${url}" — no login created.`)
    process.exit(1)
  }
  const base = origin
  const name = args.name || 'Review Tester'
  const teamName = args.team || 'Review Team'

  // better-auth checks the Origin header against trusted origins for state-changing
  // requests; the deployed origin is always trusted (createAuth trusts the request's
  // own origin), so set it explicitly for these server-to-server calls.
  const headers = { 'content-type': 'application/json', origin }
  let jar = new Map()

  async function post(path, body) {
    const res = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: { ...headers, ...(jar.size ? { cookie: cookieHeader(jar) } : {}) },
      body: JSON.stringify(body),
      redirect: 'manual'
    })
    jar = mergeCookies(jar, res)
    let json = null
    try { json = await res.json() } catch { /* non-JSON body */ }
    return { res, json }
  }

  async function get(path) {
    const res = await fetch(`${base}${path}`, {
      headers: { origin, ...(jar.size ? { cookie: cookieHeader(jar) } : {}) }
    })
    jar = mergeCookies(jar, res)
    let json = null
    try { json = await res.json() } catch { /* non-JSON body */ }
    return { res, json }
  }

  const delays = retryDelays()
  const maxAttempts = delays.length + 1
  const hasDb = !!(args.db || args.sqlite)

  // Sign in with the seed password, retrying while a fresh Worker has no auth
  // secret yet (#3474). Returns null on a 200, else the refusal code.
  async function trySignIn() {
    for (let attempt = 1; ; attempt++) {
      let res = null
      let json = null
      let threw = null
      try {
        ;({ res, json } = await post('/api/auth/sign-in/email', { email, password }))
      } catch (e) {
        threw = e
      }
      if (res?.ok) return null
      const code = threw ? (threw?.message || String(threw)) : (json?.code || json?.message || `HTTP ${res.status}`)
      if ((threw || isMissingSecretError(code)) && attempt < maxAttempts) {
        await new Promise(r => setTimeout(r, delays[attempt - 1]))
        continue
      }
      return code
    }
  }

  // Exits 1 unless sign-in ends in a 200 (#3141).
  async function signInOrExit(why) {
    const code = await trySignIn()
    if (code === null) return
    warn(`${why}: sign-in refused (${code}) — NOT advertising this login.`)
    process.exit(1)
  }

  // 0. Look the account up first (#3141) — see the header.
  let existing = false
  if (hasDb) {
    try {
      existing = querySeedCount(args, reviewerExistsSql(email)) > 0
    } catch (e) {
      warn(`could not look up ${email}: ${e?.message || e} — NOT advertising this login.`)
      process.exit(1)
    }
  }
  // An existing account that already takes the seed password (the usual redeploy) is
  // proven and needs nothing changed — step 4 verifies it. Only a refusal (old password
  // after a secret rotation #2358, or EMAIL_NOT_VERIFIED in a crouton-email app #3141)
  // resets the password and marks the address verified, then must sign in.
  const refused = existing ? await trySignIn() : null
  if (existing && refused === null) {
    info(`user ${email} already exists and takes the current password — reusing.`)
  } else if (existing) {
    info(`user ${email} already exists but refuses sign-in (${refused}) — resetting its password and marking it verified.`)
    try {
      // Take the address back first: revoke every session of it (#3141) — the reuse
      // path above revokes nothing.
      execSeedSql(args, deleteReviewerSessionsSql(email))
      execSeedSql(args, await resetPasswordSql(email, password))
      execSeedSql(args, markReviewerVerifiedSql(email))
    } catch (e) {
      warn(`could not reset/verify ${email}: ${e?.message || e} — NOT advertising this login.`)
      process.exit(1)
    }
    await signInOrExit(`existing user ${email}`)
  }

  // 1. Sign up (autoSignIn returns a session cookie on success). A brand-new Worker
  //    may not see its just-uploaded auth secret for a few seconds → retry (#3474).
  let signedUp = false
  for (let attempt = 1; !existing; attempt++) {
    let res = null
    let json = null
    let threw = null
    try {
      ;({ res, json } = await post('/api/auth/sign-up/email', { name, email, password }))
    } catch (e) {
      threw = e
    }
    const code = threw ? (threw?.message || String(threw)) : (json?.code || json?.message || `HTTP ${res.status}`)
    const decision = signUpDecision({ ok: !!res?.ok, status: res?.status, code, threw: !!threw, attempt, maxAttempts })
    if (decision === 'ok') {
      signedUp = true
      info(`signed up ${email}`)
      if (hasDb && !json?.token) {
        // Verification required (crouton-email app, #3141): no session yet. The seed
        // created this account one call ago with its own password, so verifying it
        // keeps the #3162 rule; then sign in for the steps below.
        info('sign-up gave no session (e-mail verification required) — marking it verified and signing in.')
        try {
          execSeedSql(args, markReviewerVerifiedSql(email))
        } catch (e) {
          warn(`could not mark ${email} verified: ${e?.message || e} — NOT advertising this login.`)
          process.exit(1)
        }
        await signInOrExit(`new user ${email}`)
      }
      break
    }
    if (decision === 'retry') {
      const wait = delays[attempt - 1]
      info(`sign-up: Worker not ready (${isMissingSecretError(code) ? 'no auth secret yet' : 'request error'}) — retrying in ${Math.round(wait / 1000)}s (attempt ${attempt}/${maxAttempts})`)
      await new Promise(r => setTimeout(r, wait))
      continue
    }
    if (decision === 'invite-only') {
      // #3340: public sign-up is closed — create the account in the database.
      if (!(args.db || args.sqlite)) {
        warn('invite-only app: pass --db so the seed can create the review login — NOT advertising it.')
        process.exit(1)
      }
      info(`app is invite-only — creating ${email} directly in the database.`)
      try {
        execSeedSql(args, await createReviewAccountSql(email, name, password))
        // Verified BEFORE sign-in: an invite-only app with crouton-email (velo) refuses
        // an unverified sign-in with EMAIL_NOT_VERIFIED (#3141). The seed created this
        // row itself with its own password, so the #3162 rule still holds.
        execSeedSql(args, markReviewerVerifiedSql(email))
      } catch (e) {
        warn(`could not create the review account: ${e?.message || e} — NOT advertising it.`)
        process.exit(1)
      }
      await signInOrExit(`created ${email}`)
      break
    }
    if (decision === 'exists') {
      info(`user ${email} already exists — already seeded, reusing.`)
      // Re-establish a session for the org check below.
      let { res: si } = await post('/api/auth/sign-in/email', { email, password })
      if (!si.ok && (args.db || args.sqlite)) {
        // The account holds an old password (secret rotated, #2358) — reset it, retry.
        info('existing user refuses this password — resetting it to the current one.')
        try {
          execSeedSql(args, await resetPasswordSql(email, password))
          ;({ res: si } = await post('/api/auth/sign-in/email', { email, password }))
        } catch (e) {
          warn(`password reset failed: ${e?.message || e}`)
        }
      }
      if (!si.ok) {
        warn(`existing user ${email} still refuses the current password — NOT advertising this login.`)
        process.exit(1)
      }
      break
    }
    warn(`could not create the review login after ${attempt} attempt(s) (${code}) — NOT advertising it.`)
    process.exit(1)
  }

  // 2. Capture the review user's id + whether the session already has an active org
  //    (autoCreateOnSignup / defaultTeamSlug apps do; the allowCreate pattern does not).
  let hasActiveOrg = false
  let userId = null
  try {
    const { json } = await get('/api/auth/get-session')
    hasActiveOrg = !!json?.session?.activeOrganizationId
    userId = json?.user?.id || null
    if (hasActiveOrg) info('session already has an active team.')
  } catch (e) {
    warn(`get-session error: ${e?.message || e}`)
  }

  // 3a. --seed-team (#832): attach the review user to the SEEDED demo org so the
  //     advertised login sees the content the deploy seeded — not an empty team.
  //     Runs for new AND existing users (idempotent upsert) so redeploys re-pin the
  //     active org. On success it marks the session as having an active org so the
  //     fresh-org fallback (3b) is skipped; on failure (e.g. an app that doesn't
  //     seed test1 → no such org) it falls through to 3b so the reviewer still
  //     lands inside a team rather than at a create-team wall.
  if (args.seedTeam && (args.db || args.sqlite) && userId) {
    const orgId = seedOrgId(args.seedTeam)
    const memberId = seedId('member', args.seedTeam, email)
    const createdAt = Math.floor(Date.now() / 1000)
    // Idempotent member upsert (conflict on the deterministic id → no dupes on
    // redeploy; createdAt preserved). Mirrors crouton-auth/seed's `member` shape.
    const sql =
      `INSERT INTO "member" ("id","userId","organizationId","role","createdAt") ` +
      `VALUES (${sqlStr(memberId)},${sqlStr(userId)},${sqlStr(orgId)},'owner',${createdAt}) ` +
      `ON CONFLICT("id") DO UPDATE SET ` +
      `"userId"=excluded."userId","organizationId"=excluded."organizationId","role"=excluded."role";`
    try {
      execSeedSql(args, sql)
      info(`attached ${email} to seeded team "${args.seedTeam}" (${orgId}).`)
      // Make the seeded team the review account's ONLY membership so a fresh browser
      // login resolves it as the ACTIVE org. Without this, an `autoCreateOnSignup` app
      // also mints a personal workspace that wins as trySetDefaultOrg's "first org",
      // leaving the reviewer in an empty team while the seeded data sits in test1 (#1185).
      // Scoped to this throwaway review user; the orphaned personal org is harmless.
      const pruneSql =
        `DELETE FROM "member" WHERE "userId"=${sqlStr(userId)} AND "organizationId"<>${sqlStr(orgId)};`
      execFileSync('npx', ['wrangler', 'd1', 'execute', args.db, '--remote', `--command=${pruneSql}`, '--yes'], {
        stdio: 'inherit',
        env: process.env
      })
      info(`pruned ${email}'s other memberships — seeded team is now sole/active.`)
      const { res: sa } = await post('/api/auth/organization/set-active', { organizationId: orgId })
      if (sa.ok) {
        info('set seeded team active for the session.')
        hasActiveOrg = true
      } else {
        warn(`set-active returned HTTP ${sa.status} — membership upserted but not active; falling back.`)
      }
    } catch (e) {
      warn(`seeded-team attach failed: ${e?.message || e} — falling back to a fresh review team.`)
    }
  } else if (args.seedTeam && (args.db || args.sqlite) && !userId) {
    warn('no session user id — cannot attach to the seeded team; falling back to a fresh review team.')
  }

  // 3c. --require-data (#3751): the login is only worth advertising if the seeded team
  //     actually holds the demo data. Count each named table for that team, log the
  //     counts, and exit non-zero (→ no login advertised, #1369) if any is empty or the
  //     count fails. A silent seed failure left booking-demo's login in an empty team.
  if (args.requireData?.length) {
    if (!args.seedTeam || !(args.db || args.sqlite)) {
      warn('--require-data needs --seed-team and --db/--sqlite — cannot check the team\'s data.')
      process.exit(1)
    }
    const orgId = seedOrgId(args.seedTeam)
    const counts = {}
    for (const table of args.requireData) {
      try {
        counts[table] = querySeedCount(args, teamDataCountSql(table, orgId))
      } catch (e) {
        warn(`count of ${table} for ${orgId} failed: ${e?.message || e}`)
        counts[table] = null
      }
    }
    info(`team ${orgId} data: ${Object.entries(counts).map(([t, n]) => `${t}=${n ?? 'error'}`).join(', ')}`)
    const missing = missingTeamData(counts)
    if (missing.length) {
      warn(`seeded team ${orgId} has no rows in ${missing.join(', ')} — the demo seed did not reach it; not a working review login.`)
      process.exit(1)
    }
  }

  // 3b. No active org yet → create a fresh one so the reviewer lands inside the
  //     app, not at a create-team wall (also the fallback when 3a couldn't attach).
  if (signedUp && !hasActiveOrg) {
    const slug = `review-${Math.random().toString(36).slice(2, 8)}`
    try {
      const { res, json } = await post('/api/auth/organization/create', { name: teamName, slug })
      if (res.ok) {
        const orgId = json?.id || json?.organization?.id
        info(`created team "${teamName}" (${slug})`)
        if (orgId) {
          const { res: sa } = await post('/api/auth/organization/set-active', { organizationId: orgId })
          if (sa.ok) info('set new team active for the session.')
        }
      } else {
        // 403 = app forbids user-created orgs (default-team pattern); the user is
        // already attached to the default org, so this is harmless.
        info(`team auto-create skipped (HTTP ${res.status}) — app likely uses a default/auto team.`)
      }
    } catch (e) {
      warn(`team create error: ${e?.message || e} — login still works; reviewer may need to pick a team.`)
    }
  }

  // 4. Verify the reviewer address (#3162) — last, so the seed's own session survived
  //    every call above. Only reached when the account holds the seed password.
  if (args.db || args.sqlite) {
    try {
      execSeedSql(args, markReviewerVerifiedSql(email))
      info(`marked ${email} verified.`)
    } catch (e) {
      warn(`could not mark ${email} verified: ${e?.message || e} — feedback pins will be refused.`)
    }
  }

  info('done.')
  process.exit(0)
}

// Only run as a CLI — the module is also imported for `buildLoginUrl` (by
// scripts/app-preview.mjs and the unit test), and importing must not seed.
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) main()
