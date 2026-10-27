#!/usr/bin/env node
// capture-review-surfaces.mjs — screenshot the app's DECLARED review surfaces, logged in, so the
// sign-off gate (#2171) can SHOW the owner the changed screen instead of just withholding (#2173).
//
// Runs in the DEPLOY environment on purpose: the pi worker is asked to screenshot its change
// (work-issue-pidev.yml) but runs where it often "could not typecheck the touched app" — it can't
// reliably boot the app, so it can't shoot it. The deploy already boots + logs in + screenshots
// (smoke-deployed.mjs, #293); this reuses that same auth + chromium (via the shared libs below).
//
// A blank/error page is NEVER kept: a decoy screenshot is worse than none — it would turn the
// #2172 *withhold* into a false pass. Every capture is validated (colorsAreFlat / looksLikeErrorPage
// from scripts/lib/capture-validate.mjs) before it counts as evidence.
//
// Surfaces come from the app's deploy.config.json:
//   "reviewSurfaces": [
//     { "name": "data-pane", "path": "/admin/test1/sales/events/x",
//       "do": ["click:[data-review=data-tab]", "wait:800", "click:[aria-label='Filters']"] }
//   ]
// Falls back to a single surface at reviewLogin.landing (or "/") when none are declared.
// A PR can name its own surface instead (`<!-- review-surface: <app> <path> -->`, #2433), and a
// PR held for visual sign-off that names none gets no capture rather than the landing page.
//
// Usage:
//   node scripts/capture-review-surfaces.mjs --url <deployedUrl> --pr <N> [--email <e> --password <p>] \
//        [--preview-token <t>] [--manifest apps/<app>/deploy.config.json] [--app <app>] [--out writeups/ui-proposals] [--desktop]
//   PR_BODY (env): the PR body, read for review-surface markers (#2433).
//
// Output: writeups/ui-proposals/pr<N>-<app>-<name>.png for each surface that captured a NON-blank page.
// Prints `captured=<file>` per kept shot (the workflow commits them). NEVER exits non-zero on a
// capture miss — a missing capture just means no evidence, and the sign-off gate withholds.

import { resolve } from 'node:path'
import { readFileSync, existsSync, mkdirSync } from 'node:fs'
import { parseArgs } from './lib/cli-args.mjs'
import { signIn, previewSignIn, jarToContextCookies } from './lib/review-login.mjs'
import { launchChromium } from './lib/chromium-launch.mjs'
import { colorsAreFlat, looksLikeErrorPage, looksLikeLoadingScreen, sampleFlatness } from './lib/capture-validate.mjs'

// ── pure helpers (unit-tested; no I/O) ───────────────────────────────────────

/** Kebab-slug a surface name so it is a safe, stable filename fragment. */
export function slug(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'surface'
}

/**
 * The committed filename for one surface of one PR. With `app`, the app is part of the name:
 * a packages PR deploys several apps, and without it their captures overwrote each other
 * (#2420: kassa's replaced velo's) (#2433).
 */
export function outName(pr, name, app) {
  const prefix = `pr${String(pr).replace(/\D/g, '')}`
  return app ? `${prefix}-${slug(app)}-${slug(name)}.png` : `${prefix}-${slug(name)}.png`
}

// The marker work-issue-pidev.yml puts on a PR held for visual sign-off (deploy-detect.mjs #2140).
const HOLD_MARKER = '<!-- deploy-preview: full-watch -->'

/**
 * Surfaces a PR declares for one app (#2433), copied there from its issue:
 *   <!-- review-surface: <app> <path> [name:<x>] [wait:<ms>] [click:<selector>] -->
 * The worker knows which screen it changed; the app's fixed landing page usually doesn't show it.
 */
export function parsePrSurfaces(prBody, app) {
  const out = []
  for (const m of String(prBody || '').matchAll(/<!--\s*review-surface:\s*(.+?)\s*-->/g)) {
    const [forApp, path, ...rest] = m[1].split(/\s+/)
    if (forApp !== app || !path) continue
    const nameTok = rest.find(t => t.startsWith('name:'))
    const steps = rest.filter(t => !t.startsWith('name:'))
    const base = nameTok ? nameTok.slice(5) : (path.split('?')[0].split('/').filter(Boolean).pop() || 'surface')
    let name = slug(base)
    while (out.some(s => s.name === name)) name = `${name}-${out.length + 1}`
    out.push({ name, path: path.startsWith('/') ? path : `/${path}`, do: steps })
  }
  return out
}

/**
 * What to capture for one app on one PR (#2433):
 *  - surfaces the PR declares for this app win;
 *  - a PR held for visual sign-off that declares none gets NOTHING: the landing page would pass
 *    the gate while showing nothing of the change (#2045), so the PR shows evidence as missing;
 *  - any other PR keeps the manifest's surfaces / landing, as before.
 */
export function resolveSurfaces({ manifest, prBody, app }) {
  const declared = parsePrSurfaces(prBody, app)
  if (declared.length) return { surfaces: declared, reason: 'declared on the PR' }
  if (String(prBody || '').includes(HOLD_MARKER)) {
    return { surfaces: [], reason: `held for visual sign-off but declares no review-surface for ${app} — not capturing the start page (#2433)` }
  }
  return { surfaces: parseSurfaces(manifest), reason: 'app default' }
}

/**
 * Resolve the surfaces to capture from a parsed deploy.config.json. Declared `reviewSurfaces`
 * win; otherwise ONE surface at reviewLogin.landing (or "/"). A surface needs a string `path`;
 * `do` (interaction steps) defaults to []. Names are sluggified + de-duped so two surfaces never
 * fight over the same file.
 */
export function parseSurfaces(manifest) {
  const declared = Array.isArray(manifest?.reviewSurfaces) ? manifest.reviewSurfaces : []
  const seen = new Set()
  const clean = []
  declared.forEach((s, i) => {
    if (!s || typeof s.path !== 'string' || !s.path) return
    let name = slug(s.name || `surface-${i + 1}`)
    while (seen.has(name)) name = `${name}-${i + 1}`
    seen.add(name)
    clean.push({ name, path: s.path, do: Array.isArray(s.do) ? s.do.map(String) : [] })
  })
  if (clean.length) return clean
  const landing = manifest?.reviewLogin?.landing
  return [{ name: 'preview', path: (typeof landing === 'string' && landing) ? landing : '/', do: [] }]
}

/** Parse one interaction step string into a structured action. */
export function parseAction(a) {
  const raw = String(a)
  const i = raw.indexOf(':')
  const verb = (i === -1 ? raw : raw.slice(0, i)).trim()
  const arg = i === -1 ? '' : raw.slice(i + 1)
  if (verb === 'click') return { verb: 'click', selector: arg.trim() }
  if (verb === 'wait') return { verb: 'wait', ms: Math.min(15000, Math.max(0, Number(arg) || 0)) }
  return { verb: 'unknown', raw }
}

/** Sample an 8×8 grid of a raw RGBA buffer → true if the frame is a single flat colour (blank). */
export function isFlatFrame({ data, width, height, channels }) {
  const samples = []
  for (let i = 0; i < 8; i++) {
    for (let j = 0; j < 8; j++) {
      const x = Math.floor((i + 0.5) * width / 8)
      const y = Math.floor((j + 0.5) * height / 8)
      const idx = (y * width + x) * channels
      samples.push([data[idx], data[idx + 1], data[idx + 2], channels > 3 ? data[idx + 3] : 255])
    }
  }
  return colorsAreFlat(samples)
}

// ── runtime (skipped when imported, e.g. by the test) ────────────────────────
// One shared warm-up deadline (≤5 min, inside the 8-min step timeout): the first surface pays
// for the dev server's first build; later surfaces/widths reuse the warmed server.
// Declared before `await main()` below — a later `let` would be in its TDZ when main runs.
let warmDeadline = 0

const log = m => console.log(`[capture] ${m}`)

/** One machine-readable line per surface (#2572) — the deploy step quotes these on the PR. `reason` runs to end of line. */
export function resultLine(name, status, reason = '') {
  return `surface=${name} status=${status} reason=${String(reason).replace(/\s+/g, ' ').trim()}`
}
const report = (name, status, reason) => console.log(resultLine(name, status, reason))
if (import.meta.url === `file://${process.argv[1]}`) await main()

async function main() {
  const args = parseArgs(process.argv.slice(2), { boolean: ['desktop'] })
  if (!args.url || !args.pr) {
    console.error('Usage: capture-review-surfaces.mjs --url <deployedUrl> --pr <N> [--email <e> --password <p>] [--manifest <p>] [--out <dir>] [--desktop]')
    process.exit(2)
  }
  const origin = String(args.url).replace(/\/$/, '')
  const outDir = args.out || 'writeups/ui-proposals'
  const viewport = args.desktop ? { width: 1280, height: 900 } : { width: 390, height: 844 } // phone-first (#722)
  const app = args.app || ''
  const { surfaces, reason } = resolveSurfaces({ manifest: loadManifest(args.manifest), prBody: process.env.PR_BODY || '', app })
  log(`origin=${origin} app=${app || '-'} surfaces=${surfaces.length} (${reason}) viewport=${viewport.width}x${viewport.height}`)
  if (!surfaces.length) { report('-', 'none', reason); return }

  const kept = await captureAll({ origin, args, viewport, surfaces, outDir, app })

  // The workflow reads these lines to know what to commit. No captures ⇒ no output ⇒ the
  // sign-off gate withholds (honest), rather than a decoy.
  for (const f of kept) console.log(`captured=${f}`)
  if (!kept.length) log('no valid captures — the sign-off gate will withhold (nothing to show)')
}

/** Sign in, open one browser, capture each surface. Returns the kept files (may be empty). */
async function captureAll({ origin, args, viewport, surfaces, outDir, app }) {
  // A link-only app has no password: it trades a derived preview-only token for a session (#2700).
  const { loggedIn, jar } = args['preview-token']
    ? await previewSignIn(origin, args['preview-token'], log)
    : await signIn(origin, args.email, args.password, log)
  const browser = await launchChromium(log)
  if (!browser) { for (const sf of surfaces) report(sf.name, 'error', 'no chromium browser available'); return [] } // evidence is not a gate — no browser ⇒ the sign-off gate withholds

  mkdirSync(resolve(outDir), { recursive: true })
  const kept = []
  try {
    const context = await browser.newContext({ viewport, deviceScaleFactor: 2 })
    if (loggedIn && jar.size) await context.addCookies(jarToContextCookies(jar, origin))
    if (surfaces.length) await warmUp(context, origin, surfaces[0])
    for (const surface of surfaces) {
      const file = await captureSurface(context, origin, surface, `${outDir}/${outName(args.pr, surface.name, app)}`)
      if (file) kept.push(file)
    }
  } finally {
    await browser.close().catch(() => {})
  }
  return kept
}

/**
 * Drive one surface (navigate → interact → screenshot → validate). Returns the kept file, or
 *  null when the capture is missing, an error page, or blank. Never throws.
 */
async function captureSurface(context, origin, surface, file) {
  let page
  try {
    page = await context.newPage()
    const url = origin + (surface.path.startsWith('/') ? surface.path : `/${surface.path}`)
    const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 })
    let status = resp ? resp.status() : 0
    // The dev server serves Nuxt's loading template until its first build finishes (#2526):
    // reload until real app content renders. The budget is per run (warmedUp), not per width.
    while (await isLoading(page) && Date.now() < warmDeadline) {
      await page.waitForTimeout(3000)
      const again = await page.reload({ waitUntil: 'domcontentloaded', timeout: 90000 }).catch(() => null)
      if (again) status = again.status()
    }
    if (await isLoading(page)) {
      log(`✗ ${surface.name}: capture timed out on Nuxt's loading screen — discarding`)
      report(surface.name, 'rejected', "stuck on Nuxt's loading screen")
      return null
    }
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {})
    await page.waitForTimeout(1200)
    await runInteractions(page, surface, log)
    await page.waitForTimeout(600)
    const title = await page.title().catch(() => '')
    const bodyText = await page.evaluate(() => document.body?.textContent?.slice(0, 400) || '').catch(() => '')
    await page.screenshot({ path: resolve(file), fullPage: true })
    const rejection = await captureRejection({ status, text: bodyText, title, file, browser: context.browser() })
    if (rejection) {
      log(`✗ ${surface.name}: ${rejection} — discarding`)
      report(surface.name, 'rejected', rejection)
      return null
    }
    log(`✓ ${surface.name} → ${file}`)
    report(surface.name, 'ok', okReason(file, surface))
    return file
  } catch (e) {
    log(`⚠ ${surface.name}: capture failed (non-fatal): ${e.message.split('\n')[0]}`)
    report(surface.name, 'error', `capture failed: ${e.message.split('\n')[0]}`)
    return null
  } finally {
    await page?.close().catch(() => {})
  }
}

/** Why a screenshot is NOT evidence (loader, error page, blank frame), or null when it is. Fails closed: an undecodable frame is rejected (#2526). */
async function captureRejection({ status, text, title, file, browser }) {
  if (looksLikeLoadingScreen({ text, title })) return "stuck on Nuxt's loading screen"
  if (looksLikeErrorPage({ status, text, title })) return `error page (status ${status}, title "${title}")`
  const flat = await frameIsFlat(file, browser)
  if (flat === true) return 'blank/flat capture'
  return flat === false ? null : 'could not verify the frame is not blank'
}

// A function declaration, not a const: main() runs at module top level before the
// declarations below it, so a const here threw "Cannot access 'okReason' before
// initialization" and turned every successful capture into an error (PR #2601).
function okReason(file, surface) {
  return file.split('/').pop() + (surface.clickFailed ? ` (click selector not found: ${surface.clickFailed} — captured as-is)` : '')
}

/** True while the page is Nuxt's dev loading template or no app content is visible yet. */
async function isLoading(page) {
  const html = await page.content().catch(() => '')
  const textLen = await page.evaluate(() => (document.body?.innerText || '').trim().length).catch(() => 0)
  return looksLikeLoadingScreen({ html }) || textLen <= 50
}

/** Request the first surface until the server answers with the app, not the loader. */
async function warmUp(context, origin, surface) {
  warmDeadline = Date.now() + 300_000
  const page = await context.newPage()
  try {
    await page.goto(origin + (surface.path.startsWith('/') ? surface.path : `/${surface.path}`), { waitUntil: 'domcontentloaded', timeout: 90000 }).catch(() => {})
    while (await isLoading(page) && Date.now() < warmDeadline) {
      await page.waitForTimeout(3000)
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 90000 }).catch(() => {})
    }
  } finally {
    await page.close().catch(() => {})
  }
}

/** Run a surface's `do` steps (click a selector to open a behind-a-tap screen, or wait). */
async function runInteractions(page, surface, logFn) {
  for (const step of surface.do.map(parseAction)) {
    if (step.verb === 'click') {
      try {
        await page.click(step.selector, { timeout: 6000 })
      } catch (e) {
        logFn(`⚠ ${surface.name}: click '${step.selector}' failed (${e.message.split('\n')[0]}) — capturing as-is`)
        surface.clickFailed = step.selector
      }
    } else if (step.verb === 'wait') {
      await page.waitForTimeout(step.ms)
    }
  }
}

function loadManifest(path) {
  if (!path || !existsSync(path)) return {}
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return {}
  }
}

/** true = flat/blank, false = real content, null = could not decode (treated as NOT evidence). */
async function frameIsFlat(file, browser) {
  const raw = await loadPng(file)
  if (raw) return isFlatFrame(raw)
  try {
    return colorsAreFlat(await sampleFlatness(readFileSync(resolve(file)), browser))
  } catch { return null }
}

async function loadPng(file) {
  try {
    const { default: sharp } = await import('sharp')
    const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    return { data, width: info.width, height: info.height, channels: info.channels }
  } catch { return null }
}
