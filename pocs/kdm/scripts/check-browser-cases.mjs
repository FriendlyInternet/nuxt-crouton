#!/usr/bin/env node
// Checks kdm cases 5–7 of #4153 in a real browser (Playwright) — the ones a
// status code cannot prove: sign-in still reaches the start page's form, the
// editor's link to the public page works, and the team's editors keep the
// "edit this page" pencil on the plain look.
//
//   REVIEW_SEED_SECRET=… node pocs/kdm/scripts/check-browser-cases.mjs <baseUrl> --key pr4166
//   KDM_REVIEW_EMAIL=… KDM_REVIEW_PASSWORD=… node pocs/kdm/scripts/check-browser-cases.mjs <baseUrl>
//
// `--key` is the review login's key (`pr<N>` on a PR preview, `main` on staging);
// the password is derived the same way deploy-app.yml seeds it. Cases 6–7 are
// skipped-as-FAIL without a login. Needs the seeded `welcome` page ("Welkom").
// Screenshots land in screenshots/4153-case<N>.png (repo root).
// Case 7 saves a real text change and then puts the old text back.
// Prints one line per case; exits non-zero on any failure.

import { createHash } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { chromium } from 'playwright'
import { signIn, jarToContextCookies } from '../../../scripts/lib/review-login.mjs'

const args = process.argv.slice(2)
const flag = (name) => { const i = args.indexOf(name); return i === -1 ? undefined : args[i + 1] }
const base = (args.find(a => /^https?:\/\//.test(a)) || 'http://localhost:3000').replace(/\/$/, '')
const TEAM = process.env.TEAM || 'kdm'
const TITLE = process.env.SEED_TITLE || 'Welkom'
const key = flag('--key')
const secret = process.env.REVIEW_SEED_SECRET
const email = process.env.KDM_REVIEW_EMAIL || (key ? `review+kdm-${key}@example.com` : '')
const password = process.env.KDM_REVIEW_PASSWORD
  || (key && secret ? createHash('sha256').update(`${secret}:kdm:${key}`).digest('hex').slice(0, 24) : '')

mkdirSync('screenshots', { recursive: true })
const shot = (page, n) => page.screenshot({ path: `screenshots/4153-case${n}.png`, fullPage: true }).catch(() => {})

const browser = await chromium.launch(process.env.PW_EXECUTABLE_PATH ? { executablePath: process.env.PW_EXECUTABLE_PATH } : {})
const viewport = { width: 1280, height: 900 }

async function signedInContext() {
  const { loggedIn, jar } = await signIn(base, email, password)
  if (!loggedIn) throw new Error(`sign-in as ${email || '(no login)'} failed`)
  const ctx = await browser.newContext({ viewport })
  await ctx.addCookies(jarToContextCookies(jar, base))
  return ctx
}

const cases = [
  ['5 signed out, /auth/login → ends on / with the sign-in form', async () => {
    const ctx = await browser.newContext({ viewport })
    const page = await ctx.newPage()
    await page.goto(`${base}/auth/login`, { waitUntil: 'networkidle' })
    const pw = page.locator('input[type="password"]').first()
    await pw.waitFor({ state: 'visible', timeout: 30000 }).catch(() => {})
    const path = new URL(page.url()).pathname
    const inputs = await page.locator('input:visible').count()
    const hasPassword = await pw.isVisible()
    await shot(page, 5)
    await ctx.close()
    return [path === '/' && inputs > 0 && hasPassword, `ended on ${path}, visible inputs ${inputs}, password field ${hasPassword}`]
  }],
  ['6 signed in, /admin/<team>/workspace → Pages admin; its link to "Welkom" opens a page that renders', async () => {
    const ctx = await signedInContext()
    // Capture the editor's "Open" (window.open) target instead of following a new tab.
    await ctx.addInitScript(() => { window.open = (u) => { window.__opened = String(u); return null } })
    const page = await ctx.newPage()
    const r = await page.goto(`${base}/admin/${TEAM}/workspace`, { waitUntil: 'networkidle' })
    await page.getByText(TITLE, { exact: true }).first().click({ timeout: 30000 })
    await page.getByRole('button', { name: 'More' }).first().click({ timeout: 30000 })
    await page.getByRole('menuitem', { name: 'Open' }).first().click({ timeout: 30000 })
    const opened = await page.waitForFunction(() => window.__opened, null, { timeout: 15000 }).then(h => h.jsonValue()).catch(() => '')
    await shot(page, 6)
    if (!opened) { await ctx.close(); return [false, `admin HTTP ${r?.status()}, editor "Open" gave no address`] }
    const target = new URL(opened, base).href
    const res = await page.goto(target, { waitUntil: 'networkidle' })
    const h1 = await page.locator('h1').first().textContent().catch(() => '')
    await ctx.close()
    const ok = r?.status() === 200 && res?.status() === 200 && h1?.trim() === TITLE
    return [ok, `admin HTTP ${r?.status()}, opened ${new URL(target).pathname} → HTTP ${res?.status()}, h1 "${h1?.trim()}"`]
  }],
  ['7 signed in, /<team>/en/welcome → pencil visible, opens the drawer, a saved change shows', async () => {
    const ctx = await signedInContext()
    const page = await ctx.newPage()
    const pagePath = `${base}/${TEAM}/en/welcome`
    await page.goto(pagePath, { waitUntil: 'networkidle' })
    const pencil = page.getByRole('button', { name: 'Edit Page' }).first()
    await pencil.waitFor({ state: 'visible', timeout: 30000 })
    await pencil.click()
    const drawer = page.getByRole('dialog').first()
    await drawer.waitFor({ state: 'visible', timeout: 30000 })
    // The drawer opens on Settings; the body editor is on the Content tab.
    await drawer.getByText('Content', { exact: true }).first().click({ timeout: 30000 })
    const editable = drawer.locator('[contenteditable="true"]').first()
    await editable.waitFor({ state: 'visible', timeout: 30000 })
    const before = (await editable.innerText()).trim()
    if (!before.includes(TITLE)) {
      await shot(page, 7)
      await ctx.close()
      return [false, `pencil + drawer OK, but the drawer's editor shows ${before ? `"${before.slice(0, 40)}"` : 'an empty body'} — not saved, so the page is not wiped`]
    }
    const marker = ` kdm-check-${Date.now()}`
    const save = async () => {
      await drawer.getByRole('button', { name: 'Save' }).first().click()
      await page.waitForLoadState('networkidle')
    }
    await editable.click()
    await page.keyboard.press('Control+End')
    await page.keyboard.type(marker)
    await save()
    await page.keyboard.press('Escape')
    await page.goto(pagePath, { waitUntil: 'networkidle' })
    const shown = (await page.locator('main').innerText()).includes(marker.trim())
    await shot(page, 7)
    // Put the old text back.
    await pencil.click()
    await drawer.waitFor({ state: 'visible', timeout: 30000 })
    await drawer.getByText('Content', { exact: true }).first().click({ timeout: 30000 })
    await editable.click()
    await page.keyboard.press('Control+End')
    for (let i = 0; i < marker.length; i++) await page.keyboard.press('Backspace')
    await save()
    await ctx.close()
    return [shown, `pencil + drawer OK, saved change ${shown ? 'shows' : 'does NOT show'} on the page`]
  }]
]

let failed = 0
for (const [name, run] of cases) {
  try {
    const [ok, detail] = await run()
    if (!ok) failed++
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  (${detail})`)
  } catch (e) {
    failed++
    console.log(`FAIL  ${name}  (${e.message.split('\n')[0]})`)
  }
}
await browser.close()
console.log(failed ? `\n${failed} of ${cases.length} failed` : `\nall ${cases.length} passed`)
process.exit(failed ? 1 : 0)
