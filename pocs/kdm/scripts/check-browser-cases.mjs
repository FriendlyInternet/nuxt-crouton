#!/usr/bin/env node
// Checks kdm check cases 5–6 of #4526 in a real browser (Playwright) — the ones a status
// code cannot prove.
//
//   REVIEW_SEED_SECRET=… node pocs/kdm/scripts/check-browser-cases.mjs <baseUrl> --key pr<N> [--case 5|6]
//   KDM_REVIEW_EMAIL=… KDM_REVIEW_PASSWORD=… node pocs/kdm/scripts/check-browser-cases.mjs <baseUrl>
//
// `--key` is the review login's key (`pr<N>` on a PR preview, `main` on staging); the password
// is derived the same way deploy-app.yml / scripts/staging-get.mjs seed it. Case 6 fails
// without a login. Needs the seeded `welcome` page ("Welkom") in team kdm.
// Screenshots land in screenshots/4526-case<N>.png (repo root).
//
// Case 6's last part (the demo page opens in the editor WITH its text) is a known package gap:
// no editor node is registered for `richTextBlock`, so the body opens empty. Owner's call
// (25 Nov): report it as NOT PASSED, waits on #4436 — never as a pass, and not as an exit failure.

import { createHash } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { signIn, jarToContextCookies, cookieHeader } from '../../../scripts/lib/review-login.mjs'
import { launchChromium } from '../../../scripts/lib/chromium-launch.mjs'

const GAP = 'waits on #4436 (https://github.com/FriendlyInternet/nuxt-crouton/issues/4436)'
const args = process.argv.slice(2)
const flag = (name) => { const i = args.indexOf(name); return i === -1 ? undefined : args[i + 1] }
const base = (args.find(a => /^https?:\/\//.test(a)) || 'http://localhost:3000').replace(/\/$/, '')
const only = flag('--case')
const TEAM = process.env.TEAM || 'kdm'
const TITLE = process.env.SEED_TITLE || 'Welkom'
const key = flag('--key')
const secret = process.env.REVIEW_SEED_SECRET
const email = process.env.KDM_REVIEW_EMAIL || (key ? `review+kdm-${key}@example.com` : '')
const password = process.env.KDM_REVIEW_PASSWORD
  || (key && secret ? createHash('sha256').update(`${secret}:kdm:${key}`).digest('hex').slice(0, 24) : '')

mkdirSync('screenshots', { recursive: true })
const shot = (page, n) => page.screenshot({ path: `screenshots/4526-case${n}.png`, fullPage: true }).catch(() => {})
const viewport = { width: 1280, height: 900 }
// 'load', not 'networkidle': a dev server's live-reload socket never goes quiet. Long enough
// for a dev server's first compile of a route.
const NAV_TIMEOUT = 120000

const browser = await launchChromium(msg => console.error(`browser: ${msg}`))
if (!browser) { console.log('FAIL  no launchable browser — cases 5–6 not run'); process.exit(1) }

/** Slug of the signed-in session's active team (activating the first team if none is set). */
async function activeTeamSlug(jar) {
  const headers = { 'content-type': 'application/json', origin: base, cookie: cookieHeader(jar) }
  const sess = await (await fetch(`${base}/api/auth/get-session`, { headers })).json().catch(() => null)
  const orgs = await (await fetch(`${base}/api/auth/organization/list`, { headers })).json().catch(() => [])
  const list = Array.isArray(orgs) ? orgs : []
  const activeId = sess?.session?.activeOrganizationId || list[0]?.id
  return list.find(o => o.id === activeId)?.slug || ''
}

const mark = ok => (ok ? 'PASS' : 'FAIL')

/** Open the Pages admin; true when it answers 200 and lists the demo page. */
async function openPagesAdmin(page) {
  const r = await page.goto(`${base}/admin/${TEAM}/workspace`, { waitUntil: 'load', timeout: NAV_TIMEOUT })
  const listed = await page.getByText(TITLE, { exact: true }).first()
    .waitFor({ state: 'visible', timeout: 30000 }).then(() => true, () => false)
  const ok = r?.status() === 200 && listed
  console.log(`${mark(ok)}  case 6 (Pages admin): HTTP ${r?.status()}, "${TITLE}" listed ${listed}`)
  return ok
}

/** Open the demo page in the editor and return the body editor's text. */
async function readEditorBody(page) {
  await page.getByText(TITLE, { exact: true }).first().click()
  // The editor opens on Settings; the body editor is on the Content tab.
  await page.getByText('Content', { exact: true }).first().click({ timeout: 30000 })
  const editable = page.locator('[contenteditable="true"]').first()
  await editable.waitFor({ state: 'visible', timeout: 30000 }).catch(() => {})
  await page.waitForTimeout(1500)
  return (await editable.innerText().catch(() => '')).trim()
}

/** Print the editor-body line: PASS, or the known gap (never a pass, owner 25 Nov). */
function reportEditorBody(body) {
  if (body.includes(TITLE)) { console.log('PASS  case 6 (editor body): PASS'); return true }
  const seen = body ? `"${body.slice(0, 40)}"` : 'an empty body'
  console.log(`case 6 (editor body): NOT PASSED — ${GAP} (editor shows ${seen})`)
  return false
}

/** Case 6's result: the gap never fails the exit code and never counts as a pass. */
function caseSixResult(teamOk, adminOk, bodyOk) {
  const ok = teamOk && adminOk
  if (ok && bodyOk) return { ok, detail: 'team kdm + Pages admin + editor body ok' }
  return {
    ok,
    detail: `team ${teamOk ? 'ok' : 'FAIL'}, Pages admin ${adminOk ? 'ok' : 'FAIL'}`,
    last: ok ? 'case 6: PARTLY PASSED — team kdm + Pages admin ok; editor body waits on #4436' : undefined
  }
}

const cases = [
  // covers: T5 — case 5: signed out, the sign-in address still reaches the start page's form
  ['5', '5 signed out, /auth/login → ends on / with the sign-in form', async () => {
    const ctx = await browser.newContext({ viewport })
    const page = await ctx.newPage()
    await page.goto(`${base}/auth/login`, { waitUntil: 'load', timeout: NAV_TIMEOUT })
    // login.vue forwards to / on mount (client-side), then opens the sign-in modal there.
    await page.waitForURL(u => new URL(u).pathname === '/', { timeout: NAV_TIMEOUT }).catch(() => {})
    const pw = page.locator('input[type="password"]').first()
    await pw.waitFor({ state: 'visible', timeout: 30000 }).catch(() => {})
    const path = new URL(page.url()).pathname
    const hasPassword = await pw.isVisible()
    await shot(page, 5)
    await ctx.close()
    return { ok: path === '/' && hasPassword, detail: `ended on ${path}, password field ${hasPassword}` }
  }],
  // covers: T6 — case 6: review login lands in team kdm, the Pages admin renders, the demo page opens in the editor
  ['6', '6 signed in → team kdm, /admin/kdm/workspace shows the Pages admin, "Welkom" opens in the editor', async () => {
    const { loggedIn, jar } = await signIn(base, email, password)
    if (!loggedIn) return { ok: false, detail: `sign-in as ${email || '(no login: pass --key or KDM_REVIEW_*)'} failed` }
    const slug = await activeTeamSlug(jar)
    const teamOk = slug === TEAM
    console.log(`${mark(teamOk)}  case 6 (team): active team "${slug}"`)
    const ctx = await browser.newContext({ viewport })
    await ctx.addCookies(jarToContextCookies(jar, base))
    const page = await ctx.newPage()
    const adminOk = await openPagesAdmin(page)
    const body = adminOk ? await readEditorBody(page) : ''
    await shot(page, 6)
    await ctx.close()
    return caseSixResult(teamOk, adminOk, reportEditorBody(body))
  }]
]

let failed = 0
let last = ''
const run = cases.filter(([id]) => !only || id === only)
for (const [, name, check] of run) {
  try {
    const res = await check()
    if (!res.ok) failed++
    console.log(`${res.ok ? (res.last ? 'PARTLY' : 'PASS') : 'FAIL'}  ${name}  (${res.detail})`)
    if (res.last) last = res.last
  } catch (e) {
    failed++
    console.log(`FAIL  ${name}  (${e.message.split('\n')[0]})`)
  }
}
await browser.close()
console.log(failed ? `\n${failed} of ${run.length} failed` : `\nnone of ${run.length} failed`)
if (last) console.log(last)
process.exit(failed ? 1 : 0)
