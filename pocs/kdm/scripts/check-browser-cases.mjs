#!/usr/bin/env node
// Checks kdm check cases 5–6 of #4526 in a real browser (Playwright) — the ones a status
// code cannot prove — and case 8 of #4493 (signed in, get-consents answers 200).
//   --case 5|6|8 runs one.
//
//   REVIEW_SEED_SECRET=… node pocs/kdm/scripts/check-browser-cases.mjs <baseUrl> --key pr<N> [--case 5|6]
//   KDM_REVIEW_EMAIL=… KDM_REVIEW_PASSWORD=… node pocs/kdm/scripts/check-browser-cases.mjs <baseUrl>
//
// `--key` is the review login's key (`pr<N>` on a PR preview, `main` on staging); the password
// is derived the same way deploy-app.yml / scripts/staging-get.mjs seed it. Case 6 fails
// without a login. Team kdm has no pages until step 4 (the demo page is kept out, #4559).
// Screenshots land in screenshots/4526-case<N>.png (repo root).
//
// Case 6's last part (the demo page opens in the editor WITH its text) is a known package gap:
// no editor node is registered for `richTextBlock`, so the body opens empty. Owner's call
// (25 Nov): report it as NOT PASSED, waits on #4436 — never as a pass, and not as an exit failure.
// Until step 4 the team has no pages, so the editor-body part prints NOT RUN under the same rule.

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

// Cases 5–6 need a browser; case 8 is a plain signed-in request, so only start one when asked.
const needsBrowser = !only || only === '5' || only === '6'
const browser = needsBrowser ? await launchChromium(msg => console.error(`browser: ${msg}`)) : null
if (needsBrowser && !browser) { console.log('FAIL  no launchable browser — cases 5–6 not run'); process.exit(1) }

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

/**
 * Open the Pages admin; true when it answers 200, the admin has rendered, and the demo page
 * is NOT listed (#4559). Waits for the sidebar's page search and for its list to finish
 * loading (the reorder toggle is disabled while pending) — both show even with an empty
 * list — so "not listed" cannot pass on a blank page.
 */
async function openPagesAdmin(page) {
  const r = await page.goto(`${base}/admin/${TEAM}/workspace`, { waitUntil: 'load', timeout: NAV_TIMEOUT })
  const rendered = await page.getByPlaceholder(/Search pages|Zoek pagina|Rechercher des pages/).first()
    .waitFor({ state: 'visible', timeout: 30000 })
    .then(() => page.locator('button[aria-pressed]:not([disabled])').first().waitFor({ state: 'visible', timeout: 30000 }))
    .then(() => true, () => false)
  const listed = (await page.getByText(TITLE, { exact: true }).count()) > 0
  const ok = r?.status() === 200 && rendered && !listed
  console.log(`${mark(ok)}  case 6 (Pages admin): HTTP ${r?.status()}, admin rendered ${rendered}, "${TITLE}" listed ${listed}`)
  return ok
}

// Step 4 (Kasper's pages, filled through Claude) brings back the editor-body check.
/** Case 6's result: the editor body is not run, so this is never a pass and never an exit failure. */
function caseSixResult(teamOk, adminOk) {
  const ok = teamOk && adminOk
  return {
    ok,
    detail: `team ${teamOk ? 'ok' : 'FAIL'}, Pages admin ${adminOk ? 'ok' : 'FAIL'}`,
    last: ok ? 'case 6: PARTLY PASSED — team kdm + Pages admin ok, no demo page; editor body not run (no pages until step 4), waits on #4436' : undefined
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
  // covers: T4 (#4559) — case 6: review login lands in team kdm, the Pages admin renders without the demo page
  ['6', '6 signed in → team kdm, /admin/kdm/workspace shows the Pages admin without the demo page', async () => {
    const { loggedIn, jar } = await signIn(base, email, password)
    if (!loggedIn) return { ok: false, detail: `sign-in as ${email || '(no login: pass --key or KDM_REVIEW_*)'} failed` }
    const slug = await activeTeamSlug(jar)
    const teamOk = slug === TEAM
    console.log(`${mark(teamOk)}  case 6 (team): active team "${slug}"`)
    const ctx = await browser.newContext({ viewport })
    await ctx.addCookies(jarToContextCookies(jar, base))
    const page = await ctx.newPage()
    const adminOk = await openPagesAdmin(page)
    console.log(`case 6 (editor body): NOT RUN — the team has no pages until step 4; still ${GAP}`)
    await shot(page, 6)
    await ctx.close()
    return caseSixResult(teamOk, adminOk)
  }],
  // covers: T8 (#4493) — signed in, the sign-in tables exist on this deploy: get-consents is 200, not a 500
  ['8', '8 signed in, GET /api/auth/oauth2/get-consents → 200', async () => {
    const { loggedIn, jar } = await signIn(base, email, password)
    if (!loggedIn) return { ok: false, detail: `sign-in as ${email || '(no login: pass --key or KDM_REVIEW_*)'} failed` }
    const r = await fetch(`${base}/api/auth/oauth2/get-consents`, { headers: { origin: base, cookie: cookieHeader(jar) } })
    return { ok: r.status === 200, detail: `status ${r.status}` }
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
await browser?.close()
console.log(failed ? `\n${failed} of ${run.length} failed` : `\nnone of ${run.length} failed`)
if (last) console.log(last)
process.exit(failed ? 1 : 0)
