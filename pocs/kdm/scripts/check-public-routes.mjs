#!/usr/bin/env node
// Checks kdm's plain public addresses against a running, seeded server (#4153).
//
//   node pocs/kdm/scripts/check-public-routes.mjs http://localhost:3000
//
// Expects these rows in pages_pages of team `test1` (the seed adds `welcome`;
// copy that row for the others):
//   welcome      — published, public   (title from SEED_TITLE, default "Welkom")
//   draft-page   — status: draft
//   home         — published, public, title from HOME_TITLE (default "Home")
//   members-page — published, visibility: members, title "Members only"
// Prints one line per case; exits non-zero on any failure.

const base = (process.argv[2] || 'http://localhost:3000').replace(/\/$/, '')
const WELCOME_TITLE = process.env.SEED_TITLE || 'Welkom'
const HOME_TITLE = process.env.HOME_TITLE || 'Home'
const MEMBERS_TITLE = process.env.MEMBERS_TITLE || 'Members only'

const get = (path, init = {}) => fetch(base + path, { redirect: 'follow', ...init })
const hasH1 = (html, title) => new RegExp(`<h1[^>]*>\\s*${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*</h1>`).test(html)

const cases = [
  ['1 published /welcome → 200 + title in h1', async () => {
    const r = await get('/welcome'); const html = await r.text()
    return [r.status === 200 && hasH1(html, WELCOME_TITLE), `status ${r.status}, h1 ${hasH1(html, WELCOME_TITLE)}`]
  }],
  ['2 trailing slash /welcome/ → same page', async () => {
    const r = await get('/welcome/'); const html = await r.text()
    return [r.status === 200 && hasH1(html, WELCOME_TITLE), `status ${r.status}, h1 ${hasH1(html, WELCOME_TITLE)}`]
  }],
  ['3 draft page → 404', async () => {
    const r = await get('/draft-page')
    return [r.status === 404, `status ${r.status}`]
  }],
  ['4 unknown slug → 404', async () => {
    const r = await get('/does-not-exist-4153')
    return [r.status === 404, `status ${r.status}`]
  }],
  ['5 /admin/test1/workspace reaches admin, not the catch-all', async () => {
    const r = await get('/admin/test1/workspace', { redirect: 'manual' })
    const loc = r.headers.get('location') || ''
    const html = r.status === 200 ? await r.text() : ''
    const isPublic404 = r.status === 404
    const ok = !isPublic404 && ((r.status >= 300 && r.status < 400 && /auth|login/.test(loc)) || (r.status === 200 && !hasH1(html, 'Page not found')))
    return [ok, `status ${r.status}${loc ? ` → ${loc}` : ''}`]
  }],
  ['6 published `home` served at /', async () => {
    const r = await get('/'); const html = await r.text()
    return [r.status === 200 && hasH1(html, HOME_TITLE), `status ${r.status}, h1 ${hasH1(html, HOME_TITLE)}`]
  }],
  ['7 members-only page signed out → not 200, title absent', async () => {
    const r = await get('/members-page'); const html = await r.text()
    return [r.status !== 200 && !html.includes(MEMBERS_TITLE), `status ${r.status}, title in body ${html.includes(MEMBERS_TITLE)}`]
  }],
  // Workaround for the package's `/<locale>/<slug>` links (remove via #4154).
  ['8 /en/welcome → permanent redirect to /welcome', async () => {
    const r = await get('/en/welcome', { redirect: 'manual' })
    const loc = r.headers.get('location') || ''
    return [r.status === 301 && new URL(loc, base).pathname === '/welcome', `status ${r.status}${loc ? ` → ${loc}` : ''}`]
  }],
  ['9 /en → permanent redirect to /', async () => {
    const r = await get('/en', { redirect: 'manual' })
    const loc = r.headers.get('location') || ''
    return [r.status === 301 && new URL(loc, base).pathname === '/', `status ${r.status}${loc ? ` → ${loc}` : ''}`]
  }],
  ['10 other locale /nl/welcome → 404', async () => {
    const r = await get('/nl/welcome', { redirect: 'manual' })
    return [r.status === 404, `status ${r.status}`]
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
    console.log(`FAIL  ${name}  (${e.message})`)
  }
}
console.log(failed ? `\n${failed} of ${cases.length} failed` : `\nall ${cases.length} passed`)
process.exit(failed ? 1 : 0)
