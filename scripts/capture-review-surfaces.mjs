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
//
// Usage:
//   node scripts/capture-review-surfaces.mjs --url <deployedUrl> --pr <N> [--email <e> --password <p>] \
//        [--manifest apps/<app>/deploy.config.json] [--out writeups/ui-proposals] [--desktop]
//
// Output: writeups/ui-proposals/pr<N>-<name>.png for each surface that captured a NON-blank page.
// Prints `captured=<file>` per kept shot (the workflow commits them). NEVER exits non-zero on a
// capture miss — a missing capture just means no evidence, and the sign-off gate withholds.

import { resolve } from 'node:path'
import { readFileSync, existsSync, mkdirSync } from 'node:fs'
import { parseArgs } from './lib/cli-args.mjs'
import { signIn, jarToContextCookies } from './lib/review-login.mjs'
import { launchChromium } from './lib/chromium-launch.mjs'
import { colorsAreFlat, looksLikeErrorPage } from './lib/capture-validate.mjs'

// ── pure helpers (unit-tested; no I/O) ───────────────────────────────────────

/** Kebab-slug a surface name so it is a safe, stable filename fragment. */
export function slug(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'surface'
}

/** The committed filename for one surface of one PR. */
export function outName(pr, name) {
  return `pr${String(pr).replace(/[^0-9]/g, '')}-${slug(name)}.png`
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
const log = (m) => console.log(`[capture] ${m}`)
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
  const surfaces = parseSurfaces(loadManifest(args.manifest))
  log(`origin=${origin} surfaces=${surfaces.length} viewport=${viewport.width}x${viewport.height}`)

  const { loggedIn, jar } = await signIn(origin, args.email, args.password, log)
  const browser = await launchChromium(log)
  if (!browser) return // evidence is not a gate — no browser ⇒ the sign-off gate withholds

  mkdirSync(resolve(outDir), { recursive: true })
  const kept = []
  try {
    const context = await browser.newContext({ viewport, deviceScaleFactor: 2 })
    if (loggedIn && jar.size) await context.addCookies(jarToContextCookies(jar, origin))
    for (const surface of surfaces) {
      const file = await captureSurface(context, origin, surface, `${outDir}/${outName(args.pr, surface.name)}`)
      if (file) kept.push(file)
    }
  } finally {
    await browser.close().catch(() => {})
  }

  // The workflow reads these lines to know what to commit. No captures ⇒ no output ⇒ the
  // sign-off gate withholds (honest), rather than a decoy.
  for (const f of kept) console.log(`captured=${f}`)
  if (!kept.length) log('no valid captures — the sign-off gate will withhold (nothing to show)')
}

/** Drive one surface (navigate → interact → screenshot → validate). Returns the kept file, or
 *  null when the capture is missing, an error page, or blank. Never throws. */
async function captureSurface(context, origin, surface, file) {
  let page
  try {
    page = await context.newPage()
    const url = origin + (surface.path.startsWith('/') ? surface.path : `/${surface.path}`)
    const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 })
    const status = resp ? resp.status() : 0
    await page.waitForTimeout(1200)
    await runInteractions(page, surface, log)
    await page.waitForTimeout(600)
    const title = await page.title().catch(() => '')
    const bodyText = await page.evaluate(() => document.body?.innerText?.slice(0, 400) || '').catch(() => '')
    await page.screenshot({ path: resolve(file), fullPage: true })
    if (looksLikeErrorPage({ status, text: bodyText, title })) {
      log(`✗ ${surface.name}: looks like an error page (status ${status}, "${title}") — discarding`)
      return null
    }
    const raw = await loadPng(file)
    if (raw && isFlatFrame(raw)) {
      log(`✗ ${surface.name}: blank/flat capture — discarding`)
      return null
    }
    log(`✓ ${surface.name} → ${file}`)
    return file
  } catch (e) {
    log(`⚠ ${surface.name}: capture failed (non-fatal): ${e.message.split('\n')[0]}`)
    return null
  } finally {
    await page?.close().catch(() => {})
  }
}

/** Run a surface's `do` steps (click a selector to open a behind-a-tap screen, or wait). */
async function runInteractions(page, surface, logFn) {
  for (const step of surface.do.map(parseAction)) {
    if (step.verb === 'click') {
      try { await page.click(step.selector, { timeout: 6000 }) }
      catch (e) { logFn(`⚠ ${surface.name}: click '${step.selector}' failed (${e.message.split('\n')[0]}) — capturing as-is`) }
    } else if (step.verb === 'wait') {
      await page.waitForTimeout(step.ms)
    }
  }
}

function loadManifest(path) {
  if (!path || !existsSync(path)) return {}
  try { return JSON.parse(readFileSync(path, 'utf8')) } catch { return {} }
}

async function loadPng(file) {
  try {
    const { default: sharp } = await import('sharp')
    const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    return { data, width: info.width, height: info.height, channels: info.channels }
  } catch { return null }
}
