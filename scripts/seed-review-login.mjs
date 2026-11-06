#!/usr/bin/env node
/**
 * seed-review-login.mjs — seed a throwaway, loginable test account on a fresh
 * preview deploy so a reviewer can open the URL and be inside the app in one step
 * (#608). Drives the app's OWN HTTP auth on the deployed Worker — no raw SQL, so
 * the password is hashed by better-auth exactly like a real signup.
 *
 *   node scripts/seed-review-login.mjs --url https://app-staging.workers.dev \
 *     --email review+app-pr12@example.com --password <pw> [--team "Review Team"] \
 *     [--seed-team test1 --db app-staging-db]
 *
 * Flow (all via the public auth routes the browser uses):
 *   1. POST /api/auth/sign-up/email   (autoSignIn → session cookie). An existing
 *      user (redeploy) returns USER_ALREADY_EXISTS → sign in with the given password.
 *      If that fails the account holds an OLD password (e.g. the review secret was
 *      rotated, #2358): with --db/--sqlite the password is reset to the given one
 *      (hashed with better-auth's own helper) and sign-in is retried.
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
    else if (a === '--role') out.role = argv[++i]
  }
  return out
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

/** 'ok' | 'exists' | 'retry' | 'give-up' for one sign-up attempt. */
export function signUpDecision({ ok, status, code, threw, attempt, maxAttempts }) {
  if (ok) return 'ok'
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
  const req = createRequire(new URL('../packages/crouton-auth/package.json', import.meta.url))
  const { hashPassword } = await import(pathToFileURL(req.resolve('better-auth/crypto')).href)
  return hashPassword
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

/** The review-login roles (#3421). Keep in sync with pocs/status/server/utils/review-login.ts. */
export const REVIEW_ROLES = ['member', 'admin', 'superadmin']

/** Team role the seeded membership gets: only `member` is demoted; admin + superadmin own the team. */
export function teamRoleFor(role) {
  return role === 'member' ? 'member' : 'owner'
}

/** Set (or clear) the site-admin flag on the review user. Run for every role so it is always explicit. */
export function superAdminSql(email, on) {
  return `UPDATE "user" SET "superAdmin" = ${on ? 1 : 0} WHERE lower("email") = ${sqlStr(String(email).toLowerCase())};`
}

/** Idempotent seeded-team membership upsert: re-running with a new role updates the same row. */
export function memberUpsertSql({ memberId, userId, orgId, role, createdAt }) {
  return `INSERT INTO "member" ("id","userId","organizationId","role","createdAt") ` +
    `VALUES (${sqlStr(memberId)},${sqlStr(userId)},${sqlStr(orgId)},${sqlStr(teamRoleFor(role))},${createdAt}) ` +
    `ON CONFLICT("id") DO UPDATE SET ` +
    `"userId"=excluded."userId","organizationId"=excluded."organizationId","role"=excluded."role";`
}

/**
 * Only the admin login may fall back to its own fresh team when the seeded-team attach
 * fails — there it would be that team's OWNER, which is the wrong role for member/superadmin.
 */
export function mayCreateFreshTeam(role) {
  return role === 'admin'
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
  const role = args.role ?? 'admin'
  if (!REVIEW_ROLES.includes(role)) {
    console.error(`Unknown --role "${role}" (expected ${REVIEW_ROLES.join('|')}).`)
    process.exit(2)
  }
  if (!url || !email || !password) {
    console.error('Usage: seed-review-login.mjs --url <url> --email <e> --password <p> [--name <n>] [--team <t>] [--role member|admin|superadmin] [--seed-team <slug> (--db <d1> | --sqlite <path>)]')
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

  // 1. Sign up (autoSignIn returns a session cookie on success). A brand-new Worker
  //    may not see its just-uploaded auth secret for a few seconds → retry (#3474).
  const delays = retryDelays()
  const maxAttempts = delays.length + 1
  let signedUp = false
  for (let attempt = 1; ; attempt++) {
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
      info(`signed up the ${role} login.`)
      break
    }
    if (decision === 'retry') {
      const wait = delays[attempt - 1]
      info(`sign-up: Worker not ready (${isMissingSecretError(code) ? 'no auth secret yet' : 'request error'}) — retrying in ${Math.round(wait / 1000)}s (attempt ${attempt}/${maxAttempts})`)
      await new Promise(r => setTimeout(r, wait))
      continue
    }
    if (decision === 'exists') {
      info(`the ${role} user already exists — already seeded, reusing.`)
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
        warn(`existing ${role} user still refuses the current password — NOT advertising this login.`)
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
    const sql = memberUpsertSql({ memberId, userId, orgId, role, createdAt })
    try {
      execSeedSql(args, sql)
      info(`attached the ${role} login to seeded team "${args.seedTeam}" (${orgId}).`)
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
      info(`pruned the ${role} login's other memberships — seeded team is now sole/active.`)
      const { res: sa } = await post('/api/auth/organization/set-active', { organizationId: orgId })
      if (sa.ok) {
        info('set seeded team active for the session.')
        hasActiveOrg = true
      } else {
        warn(`set-active returned HTTP ${sa.status} — membership upserted but not active; falling back.`)
      }
    } catch (e) {
      warn(`seeded-team attach failed: ${e?.message || e} — falling back to a fresh review team.`)
      if (!mayCreateFreshTeam(role)) {
        warn(`${role} login must not own a fresh team — NOT advertising it.`)
        process.exit(1)
      }
    }
  } else if (args.seedTeam && (args.db || args.sqlite) && !userId) {
    warn('no session user id — cannot attach to the seeded team; falling back to a fresh review team.')
    if (!mayCreateFreshTeam(role)) {
      warn(`${role} login could not be attached to the seeded team — NOT advertising it.`)
      process.exit(1)
    }
  }

  if (!mayCreateFreshTeam(role) && !hasActiveOrg) {
    warn(`${role} login could not be attached to the seeded team — NOT advertising it.`)
    process.exit(1)
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
      info(`marked the ${role} login verified.`)
    } catch {
      warn(`could not mark the ${role} login verified (SQL step failed) — feedback pins will be refused.`)
    }
    // The site-admin flag IS the role: a failed write must not advertise the login (a super admin
    // without the flag, or a member that kept an old one).
    if (role !== 'admin') {
      try {
        execSeedSql(args, superAdminSql(email, role === 'superadmin'))
        info(`site-admin flag set for the ${role} login.`)
      } catch {
        warn(`could not set the site-admin flag for the ${role} login (SQL step failed) — NOT advertising it.`)
        process.exit(1)
      }
    }
  }

  info('done.')
  process.exit(0)
}

// Only run as a CLI — the module is also imported for `buildLoginUrl` (by
// scripts/app-preview.mjs and the unit test), and importing must not seed.
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) main()
