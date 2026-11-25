#!/usr/bin/env node
// Checks kdm's public addresses on crouton's normal team routing (#4526, check cases 1–4),
// as plain requests against a running, seeded server:
//
//   node pocs/kdm/scripts/check-public-routes.mjs https://kdm.pmcp.dev
//   node pocs/kdm/scripts/check-public-routes.mjs http://localhost:3000
//
// Needs the crouton-pages demo page `welcome` ("Welkom") in team `kdm` — the preview seed
// (reviewTeam: kdm) or `crouton-seed --db kdm-db` adds it. Cases 5–6 need a browser:
// see check-browser-cases.mjs. Prints one line per case; exits 1 on any failure.

const base = (process.argv[2] || 'http://localhost:3000').replace(/\/$/, '')
const TEAM = process.env.TEAM || 'kdm'
const TITLE = process.env.SEED_TITLE || 'Welkom'

const get = (path) => fetch(base + path, { redirect: 'manual' })
const escape = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const h1s = html => html.match(/<h1[\s>][\s\S]*?<\/h1>/g) || []
const titleH1s = html => h1s(html).filter(h => new RegExp(`>\\s*${escape(TITLE)}\\s*<`).test(h))
const hasTag = (html, tag) => new RegExp(`<${tag}[\\s>]`).test(html)

const cases = [
  // covers: T4 — case 1: the demo page on its plain address, one h1, no menu, no footer
  [`1 GET /${TEAM}/welcome → 200, title in one h1, no nav/footer signed out`, async () => {
    const r = await get(`/${TEAM}/welcome`); const html = await r.text()
    const n = titleH1s(html).length
    const ok = r.status === 200 && n === 1 && h1s(html).length === 1 && !hasTag(html, 'nav') && !hasTag(html, 'footer')
    let detail = `status ${r.status}, title h1s ${n}, all h1s ${h1s(html).length}, nav ${hasTag(html, 'nav')}, footer ${hasTag(html, 'footer')}`
    if (r.status !== 200) {
      // The ticket asks which address answers when the plain one does not.
      const alt = await get(`/${TEAM}/en/welcome`)
      detail += `; /${TEAM}/en/welcome answered ${alt.status}${alt.headers.get('location') ? ` → ${alt.headers.get('location')}` : ''}`
    }
    return [ok, detail]
  }],
  // covers: T4 — case 2: an unknown page in team kdm is a real 404
  [`2 GET /${TEAM}/does-not-exist-4526 → 404`, async () => {
    const r = await get(`/${TEAM}/does-not-exist-4526`)
    return [r.status === 404, `status ${r.status}`]
  }],
  // covers: T4 — case 3: the scaffold's old team test1 does not serve the site
  ['3 GET /test1/welcome → 404', async () => {
    const r = await get('/test1/welcome')
    return [r.status === 404, `status ${r.status}`]
  }],
  // covers: T4 — case 4: the root is crouton's start page, not a site page or an error
  ['4 GET / → 200, crouton start page, not a site page or an error', async () => {
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
