#!/usr/bin/env node
// Checks kdm's public pages on crouton's normal team routing (#4153),
// cases 1–4 of the ticket, as plain requests against a running, seeded server:
//
//   node pocs/kdm/scripts/check-public-routes.mjs http://localhost:3000
//
// Needs the crouton-pages demo page `welcome` (title "Welkom") in team `kdm`
// — `crouton-seed --db kdm-db` adds it. Cases 5–7 need a real browser and a
// signed-in session; they are not covered here (see HANDOFF.md).
// Prints one line per case; exits non-zero on any failure.

const base = (process.argv[2] || 'http://localhost:3000').replace(/\/$/, '')
const TEAM = process.env.TEAM || 'kdm'
const TITLE = process.env.SEED_TITLE || 'Welkom'

const get = (path, init = {}) => fetch(base + path, { redirect: 'manual', ...init })
const escape = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const h1s = html => html.match(/<h1[\s>][\s\S]*?<\/h1>/g) || []
const titleH1s = html => h1s(html).filter(h => new RegExp(`>\\s*${escape(TITLE)}\\s*<`).test(h))
const hasTag = (html, tag) => new RegExp(`<${tag}[\\s>]`).test(html)

const cases = [
  [`1 GET /${TEAM}/en/welcome → 200, title in one h1, no nav/footer signed out`, async () => {
    const r = await get(`/${TEAM}/en/welcome`); const html = await r.text()
    const n = titleH1s(html).length
    const ok = r.status === 200 && n === 1 && h1s(html).length === 1 && !hasTag(html, 'nav') && !hasTag(html, 'footer')
    return [ok, `status ${r.status}, title h1s ${n}, all h1s ${h1s(html).length}, nav ${hasTag(html, 'nav')}, footer ${hasTag(html, 'footer')}`]
  }],
  ['4488-1 GET /test1/en/welcome → 404 (the old demo team is gone)', async () => {
    const r = await get('/test1/en/welcome')
    return [r.status === 404, `status ${r.status}`]
  }],
  [`2 GET /${TEAM}/welcome → forwards to /${TEAM}/en/welcome`, async () => {
    const r = await get(`/${TEAM}/welcome`)
    const loc = r.headers.get('location') || ''
    const ok = r.status >= 300 && r.status < 400 && new URL(loc, base).pathname === `/${TEAM}/en/welcome`
    return [ok, `status ${r.status}${loc ? ` → ${loc}` : ''}`]
  }],
  [`3 GET /${TEAM}/en/does-not-exist → 404`, async () => {
    const r = await get(`/${TEAM}/en/does-not-exist-4153`)
    return [r.status === 404, `status ${r.status}`]
  }],
  ['4 GET / → crouton start page (200), not a site page or an error', async () => {
    const r = await get('/'); const html = await r.text()
    const ok = r.status === 200 && titleH1s(html).length === 0 && !/Page not found/i.test(html)
    return [ok, `status ${r.status}, site title present ${titleH1s(html).length > 0}`]
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
