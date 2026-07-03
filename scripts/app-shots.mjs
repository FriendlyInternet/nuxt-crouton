#!/usr/bin/env node
// app-shots.mjs — capture screenshots of a running app with a headless browser.
//
// Reusable across apps (epic #265): turns "show me it works" into one command,
// driving the chromium PRE-INSTALLED at /opt/pw-browsers (the Playwright download
// host is egress-blocked in CI/sandbox, so we never fetch a browser).
//
// Usage:
//   node scripts/app-shots.mjs <baseUrl> <path[:name]> [more paths...] [--out <dir>] [--desktop|--viewport WxH]
//
// Viewport is MOBILE (390×844) by DEFAULT — this stack is phone-first (#722). Pass
// `--desktop` (1280×900) for wide surfaces, or `--viewport 768x1024` for a custom size.
//
// Examples:
//   node scripts/app-shots.mjs http://localhost:3008 /blog:index /blog/hello:post   # mobile
//   node scripts/app-shots.mjs https://blog.pmcp.dev / /blog --out screenshots --desktop
//
// Output: screenshots/<name>.png (name defaults to a slug of the path).
// All screenshots go in screenshots/ (repo HARD GATE) unless --out overrides.

import { existsSync, mkdirSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'

// Resolve an already-installed chromium WITHOUT pinning a build number. The
// browsers live at /opt/pw-browsers/chromium-<build>/… and the build bumps with
// Playwright; a hardcoded path silently breaks after a bump and looks like "no
// browser" (the trap that's fooled past sessions — there IS always a browser).
// So we glob the newest matching build instead. Override with
// PLAYWRIGHT_CHROMIUM_PATH.
export function findChromium() {
  const envPath = process.env.PLAYWRIGHT_CHROMIUM_PATH
  if (envPath && existsSync(envPath)) return envPath
  const root = '/opt/pw-browsers'
  if (!existsSync(root)) return undefined
  const dirs = readdirSync(root)
  const pick = (prefix, rel) =>
    dirs
      .filter(d => d.startsWith(prefix))
      .map(d => `${root}/${d}/${rel}`)
      .filter(existsSync)
      .sort() // build numbers sort lexically; newest wins
      .pop()
  return (
    pick('chromium-', 'chrome-linux/chrome')
    || pick('chromium_headless_shell-', 'chrome-linux/headless_shell')
  )
}

const argv = process.argv.slice(2)
let outDir = 'screenshots'
const outIdx = argv.indexOf('--out')
if (outIdx !== -1) {
  outDir = argv[outIdx + 1]
  argv.splice(outIdx, 2)
}
// MOBILE-FIRST by default (#722, atelier-plan): this stack is designed phone-first,
// so verify at a phone viewport unless a surface is explicitly desktop. Pass
// `--desktop` for wide surfaces, or `--viewport WxH` for a custom size.
let viewport = { width: 390, height: 844, deviceScaleFactor: 3 } // iPhone-ish
const dtIdx = argv.indexOf('--desktop')
if (dtIdx !== -1) { viewport = { width: 1280, height: 900, deviceScaleFactor: 2 }; argv.splice(dtIdx, 1) }
const vpIdx = argv.indexOf('--viewport')
if (vpIdx !== -1) {
  const [w, h] = String(argv[vpIdx + 1] || '').split('x').map(Number)
  if (w && h) viewport = { width: w, height: h, deviceScaleFactor: 2 }
  argv.splice(vpIdx, 2)
}
const [baseUrl, ...specs] = argv

if (!baseUrl || specs.length === 0) {
  console.error('Usage: node scripts/app-shots.mjs <baseUrl> <path[:name]> [more paths...] [--out <dir>]')
  process.exit(1)
}

// Find a usable, already-installed chromium. Order: PLAYWRIGHT_BROWSERS_PATH, the
// sandbox's /opt/pw-browsers, then the default ms-playwright cache.
const BROWSER_CANDIDATES = [
  process.env.PLAYWRIGHT_CHROMIUM_PATH,
  '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell',
].filter(Boolean)
const execPath = BROWSER_CANDIDATES.find((p) => p && existsSync(p))

const { chromium } = await import('playwright-core').catch(() => import('playwright'))

function slug(path) {
  const s = path.replace(/^\/+|\/+$/g, '').replace(/[^a-z0-9]+/gi, '-').toLowerCase()
  return s || 'home'
}

mkdirSync(resolve(outDir), { recursive: true })

const browser = await chromium.launch(
  execPath
    ? { executablePath: execPath, args: ['--no-sandbox', '--disable-gpu'] }
    : { args: ['--no-sandbox', '--disable-gpu'] }, // fall back to a managed browser if present
)
console.log(`browser: ${execPath || '(playwright-managed)'}  base: ${baseUrl}`)

const page = await browser.newPage({ viewport: { width: viewport.width, height: viewport.height }, deviceScaleFactor: viewport.deviceScaleFactor })
console.log(`viewport: ${viewport.width}×${viewport.height} @${viewport.deviceScaleFactor}x${viewport.width <= 500 ? ' (mobile — default; --desktop for wide)' : ''}`)
let failures = 0

for (const spec of specs) {
  const [path, name] = spec.split(':')
  const file = `${outDir}/${name || slug(path)}.png`
  const url = baseUrl.replace(/\/$/, '') + (path.startsWith('/') ? path : `/${path}`)
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 })
    await page.waitForTimeout(1500) // let client hydrate / fonts settle
    await page.screenshot({ path: resolve(file), fullPage: true })
    console.log(`✓ ${file}  ←  ${url}`)
  } catch (e) {
    failures++
    console.error(`✗ ${url}  →  ${e.message}`)
  }
}

await browser.close()
process.exit(failures ? 1 : 0)
