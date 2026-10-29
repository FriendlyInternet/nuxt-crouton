#!/usr/bin/env node
/**
 * smoke-deployed.mjs — prove a DEPLOYED preview actually works, not just that it
 * typechecked and booted (#293). Both blog runs once claimed "code-complete" off
 * typecheck + boot, yet the real acceptance — log in with the seeded admin, create
 * a record, read it back — only ever happened because a human clicked through. This
 * does that click-through headlessly against the live preview URL.
 *
 *   node scripts/smoke-deployed.mjs --url https://app.pmcp.dev \
 *     --email review+app-pr12@example.com --password <pw> \
 *     [--app app] [--manifest path/to/deploy.config.json] [--out screenshots]
 *
 * Four checks, each degrading gracefully:
 *   1. LOGIN PROOF (always, when creds given) — sign in over the app's own HTTP auth
 *      and confirm /api/auth/get-session returns an authenticated user. This alone is
 *      already more than "it booted": it proves auth works end-to-end on the real Worker
 *      (D1 + secrets + better-auth), the thing typecheck can't see.
 *   2. CRUD + PUBLIC READ (only when the app declares a `smoke.crud` block) — create a
 *      record via its API (authenticated), then read it back (publicly when asked) and
 *      assert the content is there. No declaration → skipped, not failed.
 *   3. READS (only when the app declares `smoke.reads`) — GET every listed package endpoint
 *      or page as the review login and assert status / text, so an endpoint the app consumes
 *      but CRUD never touches (a 500 from a missing migration) turns the smoke red (#3077).
 *   4. SCREENSHOT (always) — drive the CI-preinstalled chromium to the app with the
 *      session cookie injected and capture screenshots/<app>-smoke.png, so the run
 *      leaves visual proof (reuses app-shots.mjs' browser discovery).
 *
 * Exit code: non-zero if any attempted assertion FAILS (login can't authenticate, or a
 * declared CRUD step doesn't round-trip). A skipped check (no creds / no manifest) never
 * fails. The caller (deploy-app.yml) decides whether a failure gates the deploy — see its
 * "Verify deployed preview" step (report-only unless the app opts in via smoke.required).
 *
 * Manifest shape (in <app>/deploy.config.json):
 *   "smoke": {
 *     "required": true,                 // caller gates the deploy on this smoke
 *     "screenshotPath": "/",            // authenticated page to screenshot (default "/")
 *     "crud": {
 *       "create":     { "path": "/api/teams/{teamId}/posts", "method": "POST", "body": { ... } },
 *       "idFrom":     "id",             // dot-path to the new record's id in the create response
 *       "update":     { "path": "/api/teams/{teamId}/posts/{id}", "method": "PATCH", "body": { ... } },  // optional
 *       "read":       { "path": "/api/teams/{teamId}/posts?ids={id}", "expectIncludes": "<new value>" }, // optional, authenticated
 *       "readPublic": { "path": "/api/.../posts/{id}", "expectIncludes": "<text from body>" },          // optional, anonymous
 *       "delete":     { "path": "/api/teams/{teamId}/posts/{id}", "method": "DELETE" }                   // always attempted after create
 *     },
 *     "reads": [                        // authenticated GETs; {teamId} as for crud
 *       { "path": "/api/pkg/teams/{teamId}/status", "expectStatus": 200, "expectIncludes": "<text>" }
 *     ]
 *     // crud placeholders: {id}, {teamId} (session's active team), {rand} (per-run token) — see scripts/lib/smoke-crud.mjs
 *   }
 */

import { existsSync, mkdirSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { runCrud } from './lib/smoke-crud.mjs'
import { runReads } from './lib/smoke-reads.mjs'
import { mergeCookies, cookieHeader } from './lib/review-login.mjs'

// ── args ────────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const out = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--url') out.url = argv[++i]
    else if (a === '--email') out.email = argv[++i]
    else if (a === '--password') out.password = argv[++i]
    else if (a === '--app') out.app = argv[++i]
    else if (a === '--manifest') out.manifest = argv[++i]
    else if (a === '--out') out.out = argv[++i]
  }
  return out
}

const args = parseArgs(process.argv.slice(2))
const outDir = args.out || 'screenshots'
const app = args.app || 'app'
function info(m) { console.log(`[smoke] ${m}`) }
function warn(m) { console.warn(`[smoke] ⚠ ${m}`) }
function fail(m) { console.error(`[smoke] ✗ ${m}`) }

if (!args.url) {
  console.error('Usage: smoke-deployed.mjs --url <deployedUrl> [--email <e> --password <p>] [--app <n>] [--manifest <p>] [--out <dir>]')
  process.exit(2)
}
let origin
try { origin = new URL(args.url).origin } catch {
  fail(`invalid --url "${args.url}"`); process.exit(2)
}

// ── cookie jar (shared with seed-review-login.mjs) ───────────────────────────
let jar = new Map()
const baseHeaders = { 'content-type': 'application/json', origin }

async function http(method, path, body, { auth = true } = {}) {
  const res = await fetch(`${origin}${path}`, {
    method,
    headers: {
      ...(method !== 'GET' ? baseHeaders : { origin }),
      ...(auth && jar.size ? { cookie: cookieHeader(jar) } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    redirect: 'manual',
  })
  if (auth) mergeCookies(jar, res)
  let json = null
  let text = ''
  try { text = await res.clone().text() } catch { /* unreadable body */ }
  try { json = JSON.parse(text) } catch { /* non-JSON */ }
  return { res, json, text }
}

// ── load optional manifest ───────────────────────────────────────────────────
async function loadSmokeManifest() {
  const candidates = [
    args.manifest,
    `pocs/${app}/deploy.config.json`,
    `apps/${app}/deploy.config.json`,
  ].filter(Boolean)
  for (const p of candidates) {
    if (!existsSync(p)) continue
    try {
      const cfg = JSON.parse(await readFile(p, 'utf8'))
      if (cfg && cfg.smoke) { info(`using smoke manifest from ${p}`); return cfg.smoke }
    } catch (e) { warn(`could not parse ${p}: ${e.message}`) }
  }
  return null
}

// ── checks ────────────────────────────────────────────────────────────────────
const failures = []

async function loginProof() {
  if (!args.email || !args.password) {
    info('no creds passed — skipping login proof (anonymous screenshot only).')
    return false
  }
  const { res } = await http('POST', '/api/auth/sign-in/email', { email: args.email, password: args.password })
  if (!res.ok) {
    failures.push(`login: sign-in returned HTTP ${res.status}`)
    fail(`login: sign-in returned HTTP ${res.status}`)
    return false
  }
  const { json } = await http('GET', '/api/auth/get-session')
  const userId = json?.user?.id || json?.session?.userId
  if (!userId) {
    failures.push('login: get-session has no authenticated user')
    fail('login: get-session returned no user')
    return false
  }
  info(`✓ login proof — authenticated as ${json?.user?.email || userId}`)
  return true
}

async function crudProof(smoke, loggedIn) {
  const crud = smoke?.crud
  if (!crud?.create) { info('no smoke.crud declared — skipping CRUD check.'); return }
  if (!loggedIn) { failures.push('crud: declared but not logged in'); fail('crud declared but login failed — cannot CRUD.'); return }

  const failed = await runCrud(crud, {
    http,
    getTeamId: resolveTeamId,
    log: m => info(m),
  })
  for (const f of failed) { failures.push(f); fail(f) }
}

async function readsProof(smoke, loggedIn) {
  const reads = smoke?.reads
  if (!reads?.length) { info('no smoke.reads declared — skipping reads check.'); return }
  if (!loggedIn) { failures.push('reads: declared but not logged in'); fail('reads declared but login failed — cannot read.'); return }
  const failed = await runReads(reads, { http, getTeamId: resolveTeamId, log: m => info(m) })
  for (const f of failed) { failures.push(f); fail(f) }
}

/** Active team of the logged-in session; activates the account's first team when none is set. */
async function resolveTeamId() {
  const { json } = await http('GET', '/api/auth/get-session')
  const active = json?.session?.activeOrganizationId
  if (active) return active
  const { json: orgs } = await http('GET', '/api/auth/organization/list')
  const teamId = Array.isArray(orgs) ? orgs[0]?.id : undefined
  if (teamId) await http('POST', '/api/auth/organization/set-active', { organizationId: teamId })
  return teamId
}

async function screenshot(smoke, loggedIn) {
  const path = smoke?.screenshotPath || '/'
  mkdirSync(resolve(outDir), { recursive: true })
  const BROWSER_CANDIDATES = [
    process.env.PLAYWRIGHT_CHROMIUM_PATH,
    '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell',
  ].filter(Boolean)
  const execPath = BROWSER_CANDIDATES.find((p) => p && existsSync(p))
  let chromium
  try {
    ({ chromium } = await import('playwright-core').catch(() => import('playwright')))
  } catch (e) {
    warn(`no playwright available — skipping screenshot (${e.message})`)
    return
  }
  // The screenshot is evidence, never a gate: a missing browser build (e.g. a fresh
  // self-hosted runner cache, #1126) must warn and skip, not crash the smoke.
  let browser
  try {
    browser = await chromium.launch(
      execPath ? { executablePath: execPath, args: ['--no-sandbox', '--disable-gpu'] } : { args: ['--no-sandbox', '--disable-gpu'] },
    )
  } catch (e) {
    warn(`no launchable browser — skipping screenshot (non-fatal): ${e.message.split('\n')[0]}`)
    return
  }
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 })
    // Inject the authenticated session so the screenshot shows the app logged-in.
    if (loggedIn && jar.size) {
      await context.addCookies(Array.from(jar.entries()).map(([name, value]) => ({
        name, value, domain: new URL(origin).hostname, path: '/', httpOnly: true, secure: origin.startsWith('https'),
      })))
    }
    const page = await context.newPage()
    const file = `${outDir}/${app}-smoke.png`
    await page.goto(origin.replace(/\/$/, '') + (path.startsWith('/') ? path : `/${path}`), { waitUntil: 'domcontentloaded', timeout: 90000 })
    await page.waitForTimeout(1500)
    await page.screenshot({ path: resolve(file), fullPage: true })
    info(`✓ screenshot → ${file}`)
  } catch (e) {
    warn(`screenshot failed (non-fatal): ${e.message}`)
  } finally {
    await browser.close()
  }
}

// ── run ────────────────────────────────────────────────────────────────────
const smoke = await loadSmokeManifest()
let loggedIn = false
try { loggedIn = await loginProof() } catch (e) { failures.push(`login: ${e.message}`); fail(`login error: ${e.message}`) }
try { await crudProof(smoke, loggedIn) } catch (e) { failures.push(`crud: ${e.message}`); fail(`crud error: ${e.message}`) }
try { await readsProof(smoke, loggedIn) } catch (e) { failures.push(`reads: ${e.message}`); fail(`reads error: ${e.message}`) }
await screenshot(smoke, loggedIn)

if (failures.length) {
  fail(`smoke FAILED (${failures.length}): ${failures.join('; ')}`)
  process.exit(1)
}
info('smoke passed.')
process.exit(0)
