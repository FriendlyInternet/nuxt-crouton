#!/usr/bin/env node
// capture-review-surfaces.mjs — screenshot the app's DECLARED review surfaces, logged in, so the
// sign-off gate (#2171) can SHOW the owner the changed screen instead of just withholding (#2173).
//
// Runs in the DEPLOY environment on purpose: the pi worker is asked to screenshot its change
// (work-issue-pidev.yml) but runs where it often "could not typecheck the touched app" — it can't
// reliably boot the app, so it can't shoot it. The deploy already boots + logs in + screenshots
// (smoke-deployed.mjs, #293); this reuses that same auth + chromium.
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
//   node scripts/capture-review-surfaces.mjs --url <deployedUrl> --email <e> --password <p> \
//        --manifest apps/<app>/deploy.config.json --pr <N> [--out writeups/ui-proposals] [--desktop]
//
// Output: writeups/ui-proposals/pr<N>-<name>.png for each surface that captured a NON-blank page.
// Prints `captured=<file>` per kept shot (the workflow commits them). NEVER exits non-zero on a
// capture miss — a missing capture just means no evidence, and the sign-off gate withholds.

import { resolve } from 'node:path'
import { readFileSync, existsSync, mkdirSync } from 'node:fs'
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
  for (let i = 0; i < declared.length; i++) {
    const s = declared[i]
    if (!s || typeof s.path !== 'string' || !s.path) continue
    let name = slug(s.name || `surface-${i + 1}`)
    while (seen.has(name)) name = `${name}-${i + 1}`
    seen.add(name)
    clean.push({ name, path: s.path, do: Array.isArray(s.do) ? s.do.map(String) : [] })
  }
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
const isMain = import.meta.url === `file://${process.argv[1]}`
if (isMain) await main()

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const log = (m) => console.log(`[capture] ${m}`)
  if (!args.url || !args.pr) {
    console.error('Usage: capture-review-surfaces.mjs --url <deployedUrl> --pr <N> [--email <e> --password <p>] [--manifest <p>] [--out <dir>] [--desktop]')
    process.exit(2)
  }
  const origin = args.url.replace(/\/$/, '')
  const outDir = args.out || 'writeups/ui-proposals'
  const viewport = args.desktop ? { width: 1280, height: 900 } : { width: 390, height: 844 } // phone-first review (#722)

  const manifest = loadManifest(args.manifest)
  const surfaces = parseSurfaces(manifest)
  log(`origin=${origin} surfaces=${surfaces.length} viewport=${viewport.width}x${viewport.height}`)

  // 1) LOGIN (best-effort) — same auth path as smoke-deployed/seed-review-login.
  const jar = new Map()
  const loggedIn = await login(origin, jar, args.email, args.password, log)

  // 2) BROWSER — reuse smoke-deployed's chromium discovery; a missing browser is a warn+skip,
  //    never a crash (evidence is not a gate).
  const chromium = await loadChromium(log)
  if (!chromium) return
  const execPath = [
    process.env.PLAYWRIGHT_CHROMIUM_PATH,
    '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell',
  ].filter(Boolean).find((p) => p && existsSync(p))
  let browser
  try {
    browser = await chromium.launch(
      execPath ? { executablePath: execPath, args: ['--no-sandbox', '--disable-gpu'] } : { args: ['--no-sandbox', '--disable-gpu'] },
    )
  } catch (e) {
    log(`⚠ no launchable browser — skipping capture (non-fatal): ${e.message.split('\n')[0]}`)
    return
  }

  mkdirSync(resolve(outDir), { recursive: true })
  const kept = []
  try {
    const context = await browser.newContext({ viewport, deviceScaleFactor: 2 })
    if (loggedIn && jar.size) {
      await context.addCookies(Array.from(jar.entries()).map(([name, value]) => ({
        name, value, domain: new URL(origin).hostname, path: '/', httpOnly: true, secure: origin.startsWith('https'),
      })))
    }
    for (const surface of surfaces) {
      const file = `${outDir}/${outName(args.pr, surface.name)}`
      try {
        const page = await context.newPage()
        const url = origin + (surface.path.startsWith('/') ? surface.path : `/${surface.path}`)
        const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 })
        const status = resp ? resp.status() : 0
        await page.waitForTimeout(1200)
        // interaction steps (open a behind-a-tap surface, e.g. the Data pane)
        for (const step of surface.do.map(parseAction)) {
          if (step.verb === 'click') {
            try { await page.click(step.selector, { timeout: 6000 }) }
            catch (e) { log(`⚠ ${surface.name}: click '${step.selector}' failed (${e.message.split('\n')[0]}) — capturing as-is`) }
          } else if (step.verb === 'wait') {
            await page.waitForTimeout(step.ms)
          }
        }
        await page.waitForTimeout(600)
        const title = await page.title().catch(() => '')
        const bodyText = await page.evaluate(() => document.body?.innerText?.slice(0, 400) || '').catch(() => '')
        await page.screenshot({ path: resolve(file), fullPage: true })
        // 3) VALIDATE — never keep a blank or error page as "evidence" (#2055/#2061).
        if (looksLikeErrorPage({ status, text: bodyText, title })) {
          log(`✗ ${surface.name}: looks like an error page (status ${status}, "${title}") — discarding`)
          await page.close(); continue
        }
        const raw = await loadPng(file)
        if (raw && isFlatFrame(raw)) {
          log(`✗ ${surface.name}: blank/flat capture — discarding`)
          await page.close(); continue
        }
        log(`✓ ${surface.name} → ${file}`)
        kept.push(file)
        await page.close()
      } catch (e) {
        log(`⚠ ${surface.name}: capture failed (non-fatal): ${e.message.split('\n')[0]}`)
      }
    }
  } finally {
    await browser.close().catch(() => {})
  }

  // The workflow reads these lines to know what to commit. No captures ⇒ no output ⇒ the
  // sign-off gate withholds (honest), rather than a decoy.
  for (const f of kept) console.log(`captured=${f}`)
  if (!kept.length) log('no valid captures — the sign-off gate will withhold (nothing to show)')
}

function parseArgs(argv) {
  const out = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--url') out.url = argv[++i]
    else if (a === '--email') out.email = argv[++i]
    else if (a === '--password') out.password = argv[++i]
    else if (a === '--manifest') out.manifest = argv[++i]
    else if (a === '--pr') out.pr = argv[++i]
    else if (a === '--out') out.out = argv[++i]
    else if (a === '--desktop') out.desktop = true
  }
  return out
}

function loadManifest(path) {
  if (!path || !existsSync(path)) return {}
  try { return JSON.parse(readFileSync(path, 'utf8')) }
  catch { return {} }
}

async function login(origin, jar, email, password, log) {
  if (!email || !password) { log('no creds — anonymous capture only'); return false }
  const mergeCookies = (res) => {
    const set = typeof res.headers.getSetCookie === 'function'
      ? res.headers.getSetCookie()
      : (res.headers.get('set-cookie') ? [res.headers.get('set-cookie')] : [])
    for (const sc of set) {
      const pair = sc.split(';')[0]; const eq = pair.indexOf('=')
      if (eq > 0) jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim())
    }
  }
  try {
    const res = await fetch(`${origin}/api/auth/sign-in/email`, {
      method: 'POST', headers: { 'content-type': 'application/json', origin }, redirect: 'manual',
      body: JSON.stringify({ email, password }),
    })
    mergeCookies(res)
    if (!res.ok) { log(`⚠ login: sign-in HTTP ${res.status} — anonymous capture`); return false }
    log('✓ logged in for capture')
    return true
  } catch (e) { log(`⚠ login failed (${e.message}) — anonymous capture`); return false }
}

async function loadChromium(log) {
  try { const m = await import('playwright-core').catch(() => import('playwright')); return m.chromium }
  catch (e) { log(`⚠ no playwright available — skipping capture (${e.message.split('\n')[0]})`); return null }
}

async function loadPng(file) {
  try {
    const { default: sharp } = await import('sharp')
    const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    return { data, width: info.width, height: info.height, channels: info.channels }
  } catch { return null }
}
