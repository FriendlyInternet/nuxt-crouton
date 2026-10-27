#!/usr/bin/env node
/**
 * staging-get.mjs — GET a path on an app's STAGING as that app's review login (#2760),
 * so a pipeline worker can reproduce a staging bug with real responses.
 *
 *   REVIEW_SEED_SECRET=… node scripts/staging-get.mjs <app> <path> [--method GET]
 *
 * `<path>` may contain `<team>`, filled with the review login's active team id.
 * Prints HTTP status, row count (arrays, or a top-level array field) and the JSON body.
 * Never prints the password or the session cookie. Read-only: non-GET needs --method.
 */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { signIn, mergeCookies, cookieHeader } from './lib/review-login.mjs'

/** Same derivation as post-test-card.mjs loginLink() / deploy-app.yml (key `main`). */
export function reviewAccount(app, secret) {
  return {
    email: `review+${app}-main@example.com`,
    password: createHash('sha256').update(`${secret}:${app}:main`).digest('hex').slice(0, 24)
  }
}

export function readStagingUrl(app, read = readFileSync) {
  for (const dir of ['apps', 'pocs']) {
    try {
      const url = JSON.parse(read(`${dir}/${app}/deploy.config.json`, 'utf8')).stagingUrl
      if (url) return url.replace(/\/+$/, '')
    } catch { /* try the next workspace */ }
  }
  return ''
}

export function fillTeam(path, teamId) {
  return path.replace(/<team>/g, teamId ? encodeURIComponent(teamId) : '<team>')
}

const jsonHeaders = (base, jar) => ({ 'content-type': 'application/json', origin: base, cookie: cookieHeader(jar) })

/** Active team id of the signed-in session, activating the account's first team if none is set. */
async function resolveTeam(base, jar) {
  const sess = await (await fetch(`${base}/api/auth/get-session`, { headers: jsonHeaders(base, jar) })).json().catch(() => null)
  const active = sess?.session?.activeOrganizationId
  if (active) return active
  const orgs = await (await fetch(`${base}/api/auth/organization/list`, { headers: jsonHeaders(base, jar) })).json().catch(() => [])
  const teamId = Array.isArray(orgs) ? orgs[0]?.id : undefined
  if (!teamId) return undefined
  const r = await fetch(`${base}/api/auth/organization/set-active`, { method: 'POST', headers: jsonHeaders(base, jar), body: JSON.stringify({ organizationId: teamId }) })
  mergeCookies(jar, r)
  return teamId
}

/** Pretty-print a JSON body and count rows (array, or the first top-level array field). */
export function formatBody(text) {
  try {
    const json = JSON.parse(text)
    const arr = Array.isArray(json) ? json : Object.values(json ?? {}).find(Array.isArray)
    return { body: JSON.stringify(json, null, 2), count: arr ? ` · ${arr.length} row(s)` : '' }
  } catch { return { body: text, count: '' } } // non-JSON body printed as-is
}

function fail(msg, code) { console.error(msg); process.exit(code) }

async function main() {
  const argv = process.argv.slice(2)
  const mi = argv.indexOf('--method')
  const method = mi >= 0 ? (argv.splice(mi, 2)[1] || 'GET').toUpperCase() : 'GET'
  const [app, path] = argv
  if (!app || !path) fail('Usage: REVIEW_SEED_SECRET=… staging-get.mjs <app> <path> [--method GET]', 2)
  const secret = process.env.REVIEW_SEED_SECRET
  if (!secret) fail('REVIEW_SEED_SECRET is not set — cannot derive the review login.', 2)
  const base = readStagingUrl(app)
  if (!base) fail(`No stagingUrl in apps/${app}/deploy.config.json or pocs/${app}/.`, 2)

  const { email, password } = reviewAccount(app, secret)
  const { loggedIn, jar } = await signIn(base, email, password)
  if (!loggedIn) fail(`sign-in as ${email} failed`, 1)

  const wantsTeam = path.includes('<team>')
  const teamId = wantsTeam ? await resolveTeam(base, jar) : undefined
  if (wantsTeam && !teamId) fail(`${email} has no team to fill <team> with.`, 1)

  const target = fillTeam(path, teamId)
  const res = await fetch(`${base}${target}`, { method, headers: jsonHeaders(base, jar) })
  const { body, count } = formatBody(await res.text())
  console.log(`${method} ${base}${target} → HTTP ${res.status}${count}`)
  console.log(body.length > 20000 ? `${body.slice(0, 20000)}\n… (truncated)` : body)
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await main()
