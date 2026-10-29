#!/usr/bin/env node
// layer: stack
/**
 * staging-get.mjs — call a path on an app's STAGING as that app's review login (#2760, #2798),
 * so a pipeline worker can reproduce a staging bug (incl. a failing save) with real responses.
 *
 *   REVIEW_SEED_SECRET=… node scripts/staging-get.mjs <app> <path> [--method PATCH --body '{"a":1}' | --body-file f.json]
 *
 * `<path>` may contain `<team>`, filled with the review login's active team id.
 * Prints HTTP status, row count (arrays, or a top-level array field) and the JSON body.
 * Never prints the password or the session cookie. Staging hosts (*.pmcp.dev) only: any other
 * host is refused. A body is sent as JSON for non-GET methods.
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

/** Staging only (*.pmcp.dev) — a write must never reach production. Returns an error string or ''. */
export function stagingGuard(base) {
  let host = ''
  try { host = new URL(base).hostname } catch { /* falls through to refusal */ }
  return host.endsWith('.pmcp.dev') ? '' : `Refusing ${base || '(empty URL)'}: staging hosts (*.pmcp.dev) only.`
}

/** Request init for the target: body only for non-GET/HEAD, and only when one was given. */
export function buildInit(method, headers, body) {
  const init = { method, headers }
  if (body !== undefined && !['GET', 'HEAD'].includes(method)) init.body = body
  return init
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

/** Parse CLI args: positional <app> <path> plus --method / --body / --body-file (body must be JSON). */
function parseArgs(argv) {
  const take = (flag) => { const i = argv.indexOf(flag); return i >= 0 ? argv.splice(i, 2)[1] : undefined }
  const method = (take('--method') || 'GET').toUpperCase()
  let reqBody = take('--body')
  const bodyFile = take('--body-file')
  if (bodyFile) reqBody = readFileSync(bodyFile, 'utf8')
  if (reqBody !== undefined) { try { JSON.parse(reqBody) } catch { fail('--body / --body-file must be valid JSON.', 2) } }
  const [app, path] = argv
  if (!app || !path) fail('Usage: REVIEW_SEED_SECRET=… staging-get.mjs <app> <path> [--method PATCH --body <json> | --body-file <path>]', 2)
  return { method, reqBody, app, path }
}

async function main() {
  const { method, reqBody, app, path } = parseArgs(process.argv.slice(2))
  const secret = process.env.REVIEW_SEED_SECRET
  if (!secret) fail('REVIEW_SEED_SECRET is not set — cannot derive the review login.', 2)
  const base = readStagingUrl(app)
  if (!base) fail(`No stagingUrl in apps/${app}/deploy.config.json or pocs/${app}/.`, 2)

  const refusal = stagingGuard(base)
  if (refusal) fail(refusal, 2)

  const { email, password } = reviewAccount(app, secret)
  const { loggedIn, jar } = await signIn(base, email, password)
  if (!loggedIn) fail(`sign-in as ${email} failed`, 1)

  const wantsTeam = path.includes('<team>')
  const teamId = wantsTeam ? await resolveTeam(base, jar) : undefined
  if (wantsTeam && !teamId) fail(`${email} has no team to fill <team> with.`, 1)

  const target = fillTeam(path, teamId)
  const res = await fetch(`${base}${target}`, buildInit(method, jsonHeaders(base, jar), reqBody))
  if (!['GET', 'HEAD'].includes(method)) console.log(`WRITE: ${method} touched ${target} on ${base}`)
  const { body, count } = formatBody(await res.text())
  console.log(`${method} ${base}${target} → HTTP ${res.status}${count}`)
  console.log(body.length > 20000 ? `${body.slice(0, 20000)}\n… (truncated)` : body)
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await main()
