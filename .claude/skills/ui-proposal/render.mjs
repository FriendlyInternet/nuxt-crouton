#!/usr/bin/env node
/**
 * Render a self-contained HTML mockup to a PNG via Playwright (headless Chromium).
 * Offline — no network needed (the mockups must be JS/CDN-free anyway).
 *
 *   node render.mjs <input.html> <output.png> [--width N] [--selector "CSS"]
 *
 *   --width N        viewport width in px (default 1000)
 *   --selector CSS   crop to the first matching element instead of full page
 *
 * Uses the repo's existing Playwright dep (@playwright/test ships the `playwright` runtime).
 */
import { chromium } from 'playwright'
import { pathToFileURL } from 'node:url'
import { resolve, dirname, join } from 'node:path'
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { colorsAreFlat, sampleFlatness } from '../../../scripts/lib/capture-validate.mjs'

/**
 * Find an already-installed Chromium so we don't need network to download one.
 * Honours PLAYWRIGHT_CHROMIUM (explicit path), then PLAYWRIGHT_BROWSERS_PATH /
 * the usual cache dirs, picking the newest chromium-* build present.
 */
function findChromium() {
  if (process.env.PLAYWRIGHT_CHROMIUM && existsSync(process.env.PLAYWRIGHT_CHROMIUM)) {
    return process.env.PLAYWRIGHT_CHROMIUM
  }
  const roots = [
    process.env.PLAYWRIGHT_BROWSERS_PATH,
    '/opt/pw-browsers',
    join(process.env.HOME || '', '.cache', 'ms-playwright')
  ].filter(Boolean)
  for (const root of roots) {
    if (!existsSync(root)) continue
    const builds = readdirSync(root).filter(d => d.startsWith('chromium-')).sort().reverse()
    for (const b of builds) {
      for (const rel of ['chrome-linux/chrome', 'chrome-mac/Chromium.app/Contents/MacOS/Chromium', 'chrome-win/chrome.exe']) {
        const p = join(root, b, rel)
        if (existsSync(p)) return p
      }
    }
  }
  return null
}

const args = process.argv.slice(2)
const [input, output] = args.filter(a => !a.startsWith('--'))
if (!input || !output) {
  console.error('Usage: render.mjs <input.html> <output.png> [--width N] [--selector "CSS"]')
  process.exit(1)
}
const widthIdx = args.indexOf('--width')
const width = widthIdx !== -1 ? parseInt(args[widthIdx + 1], 10) : 1000
const selIdx = args.indexOf('--selector')
const selector = selIdx !== -1 ? args[selIdx + 1] : null

if (!existsSync(input)) {
  console.error(`Input not found: ${input}`)
  process.exit(1)
}
mkdirSync(dirname(resolve(output)), { recursive: true })

const executablePath = findChromium()
let browser
try {
  browser = await chromium.launch({ executablePath: executablePath || undefined, args: ['--no-sandbox'] })
} catch (err) {
  console.error('Could not launch Chromium.', executablePath ? `Tried: ${executablePath}` : 'No installed browser found.')
  console.error('Install one with:  npx playwright install chromium   (or set PLAYWRIGHT_CHROMIUM=/path/to/chrome)')
  throw err
}
try {
  const page = await browser.newPage({
    viewport: { width, height: 900 },
    deviceScaleFactor: 2 // crisp 2× output
  })
  await page.goto(pathToFileURL(resolve(input)).href, { waitUntil: 'networkidle' })
  if (selector) {
    await page.locator(selector).first().screenshot({ path: output })
  } else {
    await page.screenshot({ path: output, fullPage: true })
  }
  console.log(`✓ Rendered ${input} → ${output} (${width}px @2x${selector ? `, crop ${selector}` : ''})`)
} finally {
  await browser.close()
}
