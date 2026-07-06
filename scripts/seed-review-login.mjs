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
 *      user (redeploy) returns USER_ALREADY_EXISTS → treated as already-seeded.
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
 * Best-effort by contract: this NEVER throws a non-zero exit for an auth-level
 * problem (it prints a warning and exits 0) so a seed hiccup can't fail a deploy.
 * Only a usage error (missing --url/--email/--password) exits non-zero.
 *
 * Staging only — the caller (deploy-app.yml) gates this to environment != production.
 */

import { execFileSync } from 'node:child_process'

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
  }
  return out
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
    console.error('Usage: seed-review-login.mjs --url <deployedUrl> --email <e> --password <p> [--name <n>] [--team <t>]')
    process.exit(2)
  }

  let origin
  try {
    origin = new URL(url).origin
  } catch {
    warn(`invalid --url "${url}" — skipping seed.`)
    process.exit(0)
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

  // 1. Sign up (autoSignIn returns a session cookie on success).
  let signedUp = false
  try {
    const { res, json } = await post('/api/auth/sign-up/email', { name, email, password })
    if (res.ok) {
      signedUp = true
      info(`signed up ${email}`)
    } else {
      const code = json?.code || json?.message || `HTTP ${res.status}`
      if (res.status === 422 || /USER_ALREADY_EXISTS|already exists/i.test(String(code))) {
        info(`user ${email} already exists — already seeded, reusing.`)
        // Re-establish a session for the org check below.
        const { res: si } = await post('/api/auth/sign-in/email', { email, password })
        if (!si.ok) {
          info('existing user present; could not re-sign-in (password may differ) — login still works for the reviewer.')
          process.exit(0)
        }
      } else {
        warn(`sign-up failed (${code}) — skipping. The reviewer can still register manually.`)
        process.exit(0)
      }
    }
  } catch (e) {
    warn(`sign-up request error: ${e?.message || e} — skipping.`)
    process.exit(0)
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
  if (args.seedTeam && args.db && userId) {
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
      // execFileSync (no shell) passes the SQL as one argv entry — quotes/JSON
      // need no escaping. wrangler resolves the D1 db by name account-wide, so
      // repo-root cwd is fine. CF creds come from the deploy step's env.
      execFileSync('npx', ['wrangler', 'd1', 'execute', args.db, '--remote', `--command=${sql}`, '--yes'], {
        stdio: 'inherit',
        env: process.env
      })
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
  } else if (args.seedTeam && args.db && !userId) {
    warn('no session user id — cannot attach to the seeded team; falling back to a fresh review team.')
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

  info('done.')
  process.exit(0)
}

main()
