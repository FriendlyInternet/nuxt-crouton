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
 * Three checks, each degrading gracefully:
 *   1. LOGIN PROOF (always, when creds given) — sign in over the app's own HTTP auth
 *      and confirm /api/auth/get-session returns an authenticated user. This alone is
 *      already more than "it booted": it proves auth works end-to-end on the real Worker
 *      (D1 + secrets + better-auth), the thing typecheck can't see.
 *   2. CRUD + PUBLIC READ (only when the app declares a `smoke.crud` block) — create a
 *      record via its API (authenticated), then read it back (publicly when asked) and
 *      assert the content is there. No declaration → skipped, not failed.
 *   3. SCREENSHOT (always) — drive the CI-preinstalled chromium to the app with the
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
 *       "create":     { "path": "/api/teams/.../posts", "method": "POST", "body": { ... } },
 *       "idFrom":     "id",             // dot-path to the new record's id in the create response
 *       "readPublic": { "path": "/api/.../posts/{id}", "expectIncludes": "<text from body>" },
 *       "delete":     { "path": "/api/.../posts/{id}", "method": "DELETE" }   // optional cleanup
 *     }
 *   }
 */

import { existsSync, mkdirSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

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

// ── cookie jar (same approach as seed-review-login.mjs) ──────────────────────
function mergeCookies(jar, res) {
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
  try { json = await res.clone().json() } catch { /* non-JSON */ }
  return { res, json }
}

function dotGet(obj, dotPath) {
  return dotPath.split('.').reduce((o, k) => (o == null ? o : o[k]), obj)
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

  // create
  const c = crud.create
  const { res: cr, json: cj } = await http(c.method || 'POST', c.path, c.body ?? {})
  if (!cr.ok) { failures.push(`crud.create: HTTP ${cr.status}`); fail(`crud.create returned HTTP ${cr.status}`); return }
  const id = crud.idFrom ? dotGet(cj, crud.idFrom) : (cj?.id ?? cj?.data?.id)
  info(`✓ crud.create ok${id != null ? ` (id=${id})` : ''}`)

  // read (public = no cookie when asked)
  if (crud.readPublic) {
    const rp = crud.readPublic
    const path = String(rp.path).replace('{id}', String(id ?? ''))
    const { res: rr, json: rj } = await http('GET', path, undefined, { auth: false })
    const bodyText = JSON.stringify(rj ?? '')
    const ok = rr.ok && (!rp.expectIncludes || bodyText.includes(rp.expectIncludes))
    if (!ok) {
      failures.push(`crud.readPublic: HTTP ${rr.status}${rp.expectIncludes ? ` / missing "${rp.expectIncludes}"` : ''}`)
      fail(`crud.readPublic failed (HTTP ${rr.status})`)
    } else {
      info('✓ crud.readPublic ok — created record is publicly readable')
    }
  }

  // cleanup (best-effort, never fails the smoke)
  if (crud.delete && id != null) {
    const d = crud.delete
    try {
      await http(d.method || 'DELETE', String(d.path).replace('{id}', String(id)))
      info('✓ crud.delete cleanup ok')
    } catch (e) { warn(`crud.delete cleanup failed (non-fatal): ${e.message}`) }
  }
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
await screenshot(smoke, loggedIn)

if (failures.length) {
  fail(`smoke FAILED (${failures.length}): ${failures.join('; ')}`)
  process.exit(1)
}
info('smoke passed.')
process.exit(0)
