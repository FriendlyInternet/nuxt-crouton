#!/usr/bin/env node
// Checks kdm's public addresses on crouton's normal team routing (#4526, check cases 1–4),
// as plain requests against a running, seeded server:
//
//   node pocs/kdm/scripts/check-public-routes.mjs https://kdm.pmcp.dev
//   node pocs/kdm/scripts/check-public-routes.mjs http://localhost:3000
//   node pocs/kdm/scripts/check-public-routes.mjs <app address> [<connected domain>]
//
// Team `kdm` has no demo page: migration 0001 keeps the seed's `welcome` ("Welkom") out (#4559).
// With a second address (the connected domain, e.g. https://<the client's domain>), cases 9a–9f
// check that it answers like the team's site on the app address. Cases 7a–7c (#4493) check that
// Claude's sign-in door at /mcp is shut to unsigned requests. Cases 5, 6 and 8 need a browser/login:
// see check-browser-cases.mjs. Prints one line per case; exits 1 on any failure.

const base = (process.argv[2] || 'http://localhost:3000').replace(/\/$/, '')
const TEAM = process.env.TEAM || 'kdm'
const TITLE = process.env.SEED_TITLE || 'Welkom'

const domain = (process.argv[3] || '').replace(/\/$/, '')

const on = (origin, path) => fetch(origin + path, { redirect: 'manual' })
const get = (path) => on(base, path)
/** A redirect's target as path + query ('' when the response does not redirect). */
const loc = r => r.headers.get('location') ? (u => u.pathname + u.search)(new URL(r.headers.get('location'), 'http://x')) : ''
const escape = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const h1s = html => html.match(/<h1[\s>][\s\S]*?<\/h1>/g) || []
const titleH1s = html => h1s(html).filter(h => new RegExp(`>\\s*${escape(TITLE)}\\s*<`).test(h))

const cases = [
  // covers: T3 (#4559) — case 1: the seed's demo page is kept out of team kdm
  [`1 GET /${TEAM}/welcome → 404 (the demo page is kept out of team ${TEAM})`, async () => {
    const r = await get(`/${TEAM}/welcome`)
    return [r.status === 404, `status ${r.status}`]
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
  }],
  // covers: T7 (#4493) — /mcp refuses a request with no sign-in, and says where to sign in
  ['7a GET /mcp with no token → 401 with WWW-Authenticate', async () => {
    const r = await get('/mcp')
    const www = r.headers.get('www-authenticate')
    return [r.status === 401 && !!www, `status ${r.status}, WWW-Authenticate ${www ? `"${www.slice(0, 80)}"` : 'missing'}`]
  }],
  // covers: T7 (#4493) — a made-up bearer token is refused the same way
  ['7b GET /mcp with Authorization: Bearer x → 401 with WWW-Authenticate', async () => {
    const r = await fetch(base + '/mcp', { redirect: 'manual', headers: { authorization: 'Bearer x' } })
    const www = r.headers.get('www-authenticate')
    return [r.status === 401 && !!www, `status ${r.status}, WWW-Authenticate ${www ? 'present' : 'missing'}`]
  }],
  // covers: T7 (#4493) — the sign-in discovery document names this site's /mcp
  ['7c GET /.well-known/oauth-protected-resource → 200 JSON naming <origin>/mcp', async () => {
    const r = await get('/.well-known/oauth-protected-resource')
    const body = await r.json().catch(() => ({}))
    const want = `${new URL(base).origin}/mcp`
    return [r.status === 200 && body.resource === want, `status ${r.status}, resource ${JSON.stringify(body.resource)} (want ${want})`]
  }]
]

/** Compare one path on the connected domain with another on the app address. */
async function pair(domainPath, appPath) {
  const [d, a] = await Promise.all([on(domain, domainPath), get(appPath)])
  const detail = `domain ${domainPath} ${d.status}${loc(d) ? ` → ${loc(d)}` : ''}, app ${appPath} ${a.status}${loc(a) ? ` → ${loc(a)}` : ''}`
  return { d, a, detail }
}

if (domain) {
  cases.push(
    // covers: T5 (#4559) — case 9a: the domain's root is the team's site root, not crouton's start page
    [`9a ${domain}/ answers like /${TEAM} on the app (not 200 until step 4)`, async () => {
      const { d, a, detail } = await pair('/', `/${TEAM}`)
      return [d.status === a.status && d.status !== 200, detail]
    }],
    // covers: T5 (#4559) — case 9b: a missing page answers like the team's missing page
    [`9b ${domain}/does-not-exist-4559 answers like /${TEAM}/does-not-exist-4559`, async () => {
      const { d, a, detail } = await pair('/does-not-exist-4559', `/${TEAM}/does-not-exist-4559`)
      return [d.status === a.status, detail]
    }],
    // covers: T5 (#4559) — case 9c: a locale address answers the same, a redirect drops the /kdm prefix
    [`9c ${domain}/en/does-not-exist-4559 answers like /${TEAM}/en/does-not-exist-4559`, async () => {
      const { d, a, detail } = await pair('/en/does-not-exist-4559', `/${TEAM}/en/does-not-exist-4559`)
      let ok = d.status === a.status
      if (ok && d.status >= 300 && d.status < 400) ok = loc(d) === loc(a).replace(new RegExp(`^/${TEAM}(?=/|$)`), '')
      return [ok, detail]
    }],
    // covers: T5 (#4559) — case 9d: the admin is left alone on the domain
    [`9d ${domain}/admin/${TEAM} answers like /admin/${TEAM} on the app`, async () => {
      const { d, a, detail } = await pair(`/admin/${TEAM}`, `/admin/${TEAM}`)
      return [d.status === a.status && loc(d) === loc(a), detail]
    }],
    // covers: T5 (#4559) — case 9e: sign-in pages and the auth API are left alone on the domain
    [`9e ${domain}/auth/login and /api/auth/get-session answer like the app`, async () => {
      const login = await pair('/auth/login', '/auth/login')
      const session = await pair('/api/auth/get-session', '/api/auth/get-session')
      const ok = login.d.status === login.a.status && session.d.status === session.a.status
      return [ok, `${login.detail}; ${session.detail}`]
    }],
    // covers: T5 (#4559) — case 9f: the app's own /account page is left alone on the domain
    [`9f ${domain}/account answers like /account on the app`, async () => {
      const { d, a, detail } = await pair('/account', '/account')
      return [d.status === a.status, detail]
    }]
  )
}

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
