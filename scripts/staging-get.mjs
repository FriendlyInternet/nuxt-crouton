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

function cookieJar(jar, res) {
  for (const sc of res.headers.getSetCookie?.() ?? []) {
    const pair = sc.split(';')[0]
    const eq = pair.indexOf('=')
    if (eq > 0) jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim())
  }
}
const cookieHeader = jar => [...jar].map(([k, v]) => `${k}=${v}`).join('; ')

async function main() {
  const argv = process.argv.slice(2)
  const mi = argv.indexOf('--method')
  const method = mi >= 0 ? (argv.splice(mi, 2)[1] || 'GET').toUpperCase() : 'GET'
  const [app, path] = argv
  if (!app || !path) {
    console.error('Usage: REVIEW_SEED_SECRET=… staging-get.mjs <app> <path> [--method GET]')
    process.exit(2)
  }
  const secret = process.env.REVIEW_SEED_SECRET
  if (!secret) { console.error('REVIEW_SEED_SECRET is not set — cannot derive the review login.'); process.exit(2) }
  const base = readStagingUrl(app)
  if (!base) { console.error(`No stagingUrl in apps/${app}/deploy.config.json or pocs/${app}/.`); process.exit(2) }

  const { email, password } = reviewAccount(app, secret)
  const headers = { 'content-type': 'application/json', origin: base }
  const jar = new Map()

  const signIn = await fetch(`${base}/api/auth/sign-in/email`, { method: 'POST', headers, body: JSON.stringify({ email, password }) })
  cookieJar(jar, signIn)
  if (!signIn.ok) { console.error(`sign-in as ${email} failed: HTTP ${signIn.status}`); process.exit(1) }

  let sess = await (await fetch(`${base}/api/auth/get-session`, { headers: { ...headers, cookie: cookieHeader(jar) } })).json().catch(() => null)
  let teamId = sess?.session?.activeOrganizationId
  if (!teamId && path.includes('<team>')) {
    // No active team yet — activate the first one the account belongs to.
    const orgsRes = await fetch(`${base}/api/auth/organization/list`, { headers: { ...headers, cookie: cookieHeader(jar) } })
    const orgs = await orgsRes.json().catch(() => [])
    teamId = Array.isArray(orgs) ? orgs[0]?.id : undefined
    if (teamId) {
      const r = await fetch(`${base}/api/auth/organization/set-active`, { method: 'POST', headers: { ...headers, cookie: cookieHeader(jar) }, body: JSON.stringify({ organizationId: teamId }) })
      cookieJar(jar, r)
    }
  }
  if (path.includes('<team>') && !teamId) { console.error(`${email} has no team to fill <team> with.`); process.exit(1) }

  const target = fillTeam(path, teamId)
  const res = await fetch(`${base}${target}`, { method, headers: { ...headers, cookie: cookieHeader(jar) } })
  const text = await res.text()
  let body = text
  let count = ''
  try {
    const json = JSON.parse(text)
    body = JSON.stringify(json, null, 2)
    const arr = Array.isArray(json) ? json : Object.values(json ?? {}).find(Array.isArray)
    if (arr) count = ` · ${arr.length} row(s)`
  } catch { /* non-JSON body printed as-is */ }
  console.log(`${method} ${base}${target} → HTTP ${res.status}${count}`)
  console.log(body.length > 20000 ? `${body.slice(0, 20000)}\n… (truncated)` : body)
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await main()
