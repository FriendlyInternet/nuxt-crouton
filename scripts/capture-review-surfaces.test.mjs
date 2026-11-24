import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { inflateSync } from 'node:zlib'
import { slug, outName, parseSurfaces, parseAction, isFlatFrame, parsePrSurfaces, resolveSurfaces, resultLine, deriveSurfaces, readPrBody, pickSurfaces, settlePage, waitForHydration, changesScreen, appPackages, landingRejection, isAuthPath, authTryDecision, noneReason, sessionFromResponse } from './capture-review-surfaces.mjs'
import * as captureModule from './capture-review-surfaces.mjs'
import { LOADING_MARKERS } from './lib/capture-validate.mjs'

test('slug: safe stable filename fragment', () => {
  assert.equal(slug('Data Pane / Filter!'), 'data-pane-filter')
  assert.equal(slug(''), 'surface')
  assert.equal(slug(undefined), 'surface')
  assert.equal(slug('--Already--Kebab--'), 'already-kebab')
})

test('outName: pr<N>-<slug>.png, digits only from pr', () => {
  assert.equal(outName('2147', 'Data Pane'), 'pr2147-data-pane.png')
  assert.equal(outName('pr2147', 'x'), 'pr2147-x.png')
  assert.equal(outName(2147, 'preview'), 'pr2147-preview.png')
})

test('parseSurfaces: declared surfaces win, defaults applied, names de-duped', () => {
  const m = { reviewSurfaces: [
    { name: 'Data', path: '/admin/x', do: ['click:.tab', 'wait:500'] },
    { name: 'Data', path: '/admin/y' }, // same name → de-duped
    { path: '/admin/z' }, // no name → surface-3
    { name: 'skip', path: '' }, // no path → dropped
    null // junk → dropped
  ] }
  const s = parseSurfaces(m)
  assert.equal(s.length, 3)
  assert.deepEqual(s[0], { name: 'data', path: '/admin/x', do: ['click:.tab', 'wait:500'] })
  assert.notEqual(s[1].name, s[0].name) // de-duped, not overwriting the file
  assert.equal(s[2].name, 'surface-3')
  assert.deepEqual(s[2].do, []) // do defaults to []
})

test('parseSurfaces: falls back to reviewLogin.landing, then "/"', () => {
  assert.deepEqual(parseSurfaces({ reviewLogin: { landing: '/admin/test1/sales' } }),
    [{ name: 'preview', path: '/admin/test1/sales', do: [] }])
  assert.deepEqual(parseSurfaces({}), [{ name: 'preview', path: '/', do: [] }])
  assert.deepEqual(parseSurfaces({ reviewSurfaces: [] }), [{ name: 'preview', path: '/', do: [] }])
})

test('parseAction: click / wait / unknown; wait clamped', () => {
  assert.deepEqual(parseAction('click:[data-review=tab]'), { verb: 'click', selector: '[data-review=tab]' })
  assert.deepEqual(parseAction('click:[aria-label=\'Filters\']'), { verb: 'click', selector: '[aria-label=\'Filters\']' })
  assert.deepEqual(parseAction('wait:800'), { verb: 'wait', ms: 800 })
  assert.deepEqual(parseAction('wait:99999'), { verb: 'wait', ms: 15000 }) // clamped
  assert.deepEqual(parseAction('wait:-5'), { verb: 'wait', ms: 0 })
  assert.equal(parseAction('frobnicate:x').verb, 'unknown')
})

test('isFlatFrame: a single-colour frame is flat (blank), a varied one is not', () => {
  const flat = { width: 8, height: 8, channels: 4, data: new Uint8ClampedArray(8 * 8 * 4).fill(255) }
  assert.equal(isFlatFrame(flat), true)
  // a frame with a clearly different quadrant is NOT flat
  const varied = new Uint8ClampedArray(8 * 8 * 4).fill(255)
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 8; x++) {
      const idx = (y * 8 + x) * 4
      varied[idx] = 0
      varied[idx + 1] = 0
      varied[idx + 2] = 0
    }
  }
  assert.equal(isFlatFrame({ width: 8, height: 8, channels: 4, data: varied }), false)
})

// #3854 — a full-page capture of a tall page (#3841: 780 × 25,280) put the old 8×8 grid rows
// ~3,160 px apart, so cards between them were never sampled and the page read as blank.
function whiteFrame(width, height, rgb = [255, 255, 255]) {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let i = 0; i < data.length; i += 4) {
    data[i] = rgb[0]; data[i + 1] = rgb[1]; data[i + 2] = rgb[2]; data[i + 3] = 255
  }
  return { width, height, channels: 4, data }
}
function fillRect(frame, x0, y0, w, h, rgb = [30, 30, 30]) {
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      const idx = (y * frame.width + x) * 4
      frame.data[idx] = rgb[0]; frame.data[idx + 1] = rgb[1]; frame.data[idx + 2] = rgb[2]
    }
  }
}

test('isFlatFrame: a one-colour frame is flat at any size (#3854)', () => {
  assert.equal(isFlatFrame(whiteFrame(780, 25280)), true)
  assert.equal(isFlatFrame(whiteFrame(390, 844, [0xf4, 0xf4, 0xf5])), true)
})

test('isFlatFrame: a tall page with cards between the old 8×8 grid points is not flat (#3854)', () => {
  const frame = whiteFrame(780, 25280)
  for (let band = 0; band < 8; band++) fillRect(frame, 150, band * 3160 + 400, 300, 120)
  assert.equal(isFlatFrame(frame), false)
})

test('isFlatFrame: a short normal page is not flat (#3854)', () => {
  const frame = whiteFrame(390, 844)
  fillRect(frame, 0, 0, 390, 56)
  for (const y of [120, 160, 200, 240]) fillRect(frame, 24, y, 200, 14)
  assert.equal(isFlatFrame(frame), false)
})

test('isFlatFrame: a nearly empty page with one small button is not flat (#3854)', () => {
  const frame = whiteFrame(780, 1688)
  fillRect(frame, 340, 800, 100, 30)
  assert.equal(isFlatFrame(frame), false)
})

test('isFlatFrame: a single 1-px line is still blank (#3854)', () => {
  const row = whiteFrame(780, 25280)
  fillRect(row, 0, 12000, 780, 1)
  assert.equal(isFlatFrame(row), true)
  const col = whiteFrame(780, 25280)
  fillRect(col, 400, 0, 1, 25280)
  assert.equal(isFlatFrame(col), true)
})

// #2433 — the PR (copied from its issue) names the page that shows the change. Without it the
// capture shot each app's fixed landing page, and that unrelated screenshot satisfied the
// sign-off gate (#2420: the kassa POS launcher, for a page-editor change).
const HOLD = '<!-- deploy-preview: full-watch -->'
const EDITOR = '<!-- review-surface: kassa /admin/test1/workspace?page=seed:page:test1:vlaamsekermis name:editor wait:2500 -->'

// #4141 case 5 — `{team}` in a declared path, and a derived `[team]` route, become the app's
// review team (deploy.config.json `reviewTeam`), default test1.
test('#4141 parsePrSurfaces fills {team} with the review team, default test1', () => {
  const body = '<!-- review-surface: kdm /admin/{team}/workspace -->'
  assert.deepEqual(parsePrSurfaces(body, 'kdm', 'kdm'), [{ name: 'workspace', path: '/admin/kdm/workspace', do: [] }])
  assert.deepEqual(parsePrSurfaces(body, 'kdm'), [{ name: 'workspace', path: '/admin/test1/workspace', do: [] }])
})

test('#4141 resolveSurfaces uses the manifest reviewTeam for declared and derived surfaces', () => {
  const manifest = { reviewTeam: 'kdm' }
  const declared = resolveSurfaces({ manifest, prBody: '<!-- review-surface: kdm /admin/{team}/workspace -->', app: 'kdm', changedFiles: [] })
  assert.equal(declared.surfaces[0].path, '/admin/kdm/workspace')
  const derived = resolveSurfaces({ manifest, prBody: '', app: 'kdm', changedFiles: ['pocs/kdm/app/pages/admin/[team]/workspace.vue'] })
  assert.deepEqual(derived.surfaces.map(s => s.path), ['/admin/kdm/workspace'])
  const plain = resolveSurfaces({ manifest: {}, prBody: '', app: 'kdm', changedFiles: ['pocs/kdm/app/pages/admin/[team]/workspace.vue'] })
  assert.deepEqual(plain.surfaces.map(s => s.path), ['/admin/test1/workspace'])
})

test('outName: includes the app so two apps on one PR do not overwrite each other', () => {
  assert.equal(outName(2420, 'preview', 'kassa'), 'pr2420-kassa-preview.png')
  assert.equal(outName(2420, 'preview', 'velo'), 'pr2420-velo-preview.png')
})

test('parsePrSurfaces: picks this app\'s markers, with path query, name and steps', () => {
  const body = `Closes #1\n${EDITOR}\n<!-- review-surface: velo /admin/test1/pages -->`
  assert.deepEqual(parsePrSurfaces(body, 'kassa'), [
    { name: 'editor', path: '/admin/test1/workspace?page=seed:page:test1:vlaamsekermis', do: ['wait:2500'] },
  ])
  assert.deepEqual(parsePrSurfaces(body, 'velo'), [{ name: 'pages', path: '/admin/test1/pages', do: [] }])
  assert.deepEqual(parsePrSurfaces(body, 'triage'), [])
  assert.deepEqual(parsePrSurfaces('', 'kassa'), [])
})

test('resolveSurfaces: a declared surface replaces the app default', () => {
  const manifest = { reviewLogin: { landing: '/admin/test1/sales/events/vlaamsekermis' } }
  const s = resolveSurfaces({ manifest, prBody: `${HOLD}\n${EDITOR}`, app: 'kassa' })
  assert.equal(s.surfaces[0].name, 'editor')
  assert.equal(s.surfaces.length, 1)
})

test('resolveSurfaces: a held PR that declares nothing for this app gets NO start-page shot', () => {
  const manifest = { reviewLogin: { landing: '/admin/test1/sales/events/vlaamsekermis' } }
  const s = resolveSurfaces({ manifest, prBody: `Closes #1${HOLD}`, app: 'kassa' })
  assert.deepEqual(s.surfaces, [])
  assert.match(s.reason, /declares no review-surface/)
})

test('resolveSurfaces: an ordinary app PR keeps the manifest surfaces', () => {
  const manifest = { reviewLogin: { landing: '/admin/test1/sales' } }
  assert.deepEqual(resolveSurfaces({ manifest, prBody: 'Closes #5', app: 'kassa' }).surfaces,
    [{ name: 'preview', path: '/admin/test1/sales', do: [] }])
})

// Minimal decoder for the 8-bit non-interlaced RGB(A) fixture — the scripts CI job has no
// `pnpm install`, so `sharp` is not resolvable there.
function idatPayload(buf) {
  const idat = []
  for (let o = 8; o < buf.length;) {
    const len = buf.readUInt32BE(o)
    if (buf.toString('latin1', o + 4, o + 8) === 'IDAT') idat.push(buf.subarray(o + 8, o + 8 + len))
    o += 12 + len
  }
  return Buffer.concat(idat)
}

function paethPredictor(a, b, c) {
  const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c)
  if (pa <= pb && pa <= pc) return a
  return pb <= pc ? b : c
}

function unfilterRow(raw, data, y, stride, channels) {
  const filter = raw[y * (stride + 1)]
  for (let x = 0; x < stride; x++) {
    const v = raw[y * (stride + 1) + 1 + x]
    const a = x >= channels ? data[y * stride + x - channels] : 0
    const b = y > 0 ? data[(y - 1) * stride + x] : 0
    const c = x >= channels && y > 0 ? data[(y - 1) * stride + x - channels] : 0
    data[y * stride + x] = (v + [0, a, b, (a + b) >> 1, paethPredictor(a, b, c)][filter]) & 255
  }
}

function decodePng(buf) {
  const width = buf.readUInt32BE(16)
  const height = buf.readUInt32BE(20)
  const channels = buf[25] === 6 ? 4 : 3
  const raw = inflateSync(idatPayload(buf))
  const stride = width * channels
  const data = Buffer.alloc(stride * height)
  for (let y = 0; y < height; y++) unfilterRow(raw, data, y, stride, channels)
  return { data, width, height, channels }
}

test('isFlatFrame: rejects the committed all-white 390px capture (#2526)', () => {
  const frame = decodePng(readFileSync(new URL('./lib/__fixtures__/blank-white-390.png', import.meta.url)))
  assert.equal(isFlatFrame(frame), true)
})

test('resultLine is one machine-readable line per surface (#2572)', () => {
  assert.equal(resultLine('month', 'rejected', 'blank/flat\ncapture'), 'surface=month status=rejected reason=blank/flat capture')
})

test("parsePrSurfaces keeps a quoted has-text('Month') selector intact (#2572)", () => {
  const body = "<!-- review-surface: velo /admin/test1/bookings name:month click:button:has-text('Month') wait:1500 -->"
  assert.deepEqual(parsePrSurfaces(body, 'velo'), [{ name: 'month', path: '/admin/test1/bookings', do: ["click:button:has-text('Month')", 'wait:1500'] }])
})

test('deriveSurfaces: page file → route, team segment → seeded team (#2698)', () => {
  const s = deriveSurfaces({ app: 'velo', changedFiles: [
    'apps/velo/app/pages/admin/[team]/sales/index.vue',
    'apps/velo/app/pages/index.vue',
    'apps/velo/app/pages/posts/[id].vue', // unknown dynamic segment → skipped
    'apps/velo/app/components/Foo.vue', // not a page, not gallery → skipped
    'README.md'
  ] })
  assert.deepEqual(s.map(x => x.path), ['/admin/test1/sales', '/'])
})

test('deriveSurfaces: a POC page only maps for its own app (#3794)', () => {
  const changedFiles = ['pocs/booking-demo/app/pages/admin/[team]/blocks.vue']
  assert.deepEqual(deriveSurfaces({ app: 'booking-demo', changedFiles }), [{ name: 'admin-team-blocks', path: '/admin/test1/blocks', do: [] }])
  assert.deepEqual(deriveSurfaces({ app: 'crouton-builder', changedFiles }), [])
  assert.deepEqual(deriveSurfaces({ app: 'gallery', changedFiles }), [])
  assert.deepEqual(deriveSurfaces({ app: 'kassa', changedFiles: ['apps/velo/app/pages/about.vue'] }), [])
})

test('deriveSurfaces: a fixtures/ or e2e/ page gives no surface for any app (#4084)', () => {
  const changedFiles = [
    'fixtures/with-relations/app/pages/admin/[team]/relations-check.vue',
    'e2e/x/app/pages/foo.vue'
  ]
  for (const app of ['pins', 'velo', 'gallery']) {
    assert.deepEqual(deriveSurfaces({ app, changedFiles }), [])
  }
})

test('deriveSurfaces: a [slug] segment is not the team (#3886)', () => {
  assert.deepEqual(deriveSurfaces({ app: 'crouton-builder', changedFiles: ['pocs/crouton-builder/app/pages/site/[slug].vue'] }), [])
})

test('deriveSurfaces: [team], [teamSlug], [team-slug] still map to the seeded team (#3886)', () => {
  const s = deriveSurfaces({ app: 'velo', changedFiles: [
    'apps/velo/app/pages/a/[team]/x.vue',
    'apps/velo/app/pages/b/[teamSlug]/x.vue',
    'apps/velo/app/pages/c/[team-slug]/x.vue'
  ] })
  assert.deepEqual(s.map(x => x.path), ['/a/test1/x', '/b/test1/x', '/c/test1/x'])
})

test('deriveSurfaces: a packages/ page maps for any app (#3794)', () => {
  const changedFiles = ['packages/crouton-x/app/pages/foo.vue']
  for (const app of ['velo', 'gallery']) {
    const s = deriveSurfaces({ app, changedFiles })
    assert.equal(s.length, 1)
    assert.equal(s[0].path, '/foo')
  }
})

test('deriveSurfaces: package component only maps for the gallery', () => {
  const f = ['packages/crouton-core/app/components/Pill.vue']
  assert.deepEqual(deriveSurfaces({ app: 'velo', changedFiles: f }), [])
  const g = deriveSurfaces({ app: 'gallery', changedFiles: f })
  assert.equal(g[0].path, '/__review?file=packages%2Fcrouton-core%2Fapp%2Fcomponents%2FPill.vue')
})

test('resolveSurfaces: declared wins over derived; derived wins over the landing page', () => {
  const changedFiles = ['apps/velo/app/pages/about.vue']
  const body = '<!-- review-surface: velo /x -->'
  assert.equal(resolveSurfaces({ manifest: {}, prBody: body, app: 'velo', changedFiles }).surfaces[0].path, '/x')
  assert.equal(resolveSurfaces({ manifest: {}, prBody: '', app: 'velo', changedFiles }).surfaces[0].path, '/about')
  assert.equal(resolveSurfaces({ manifest: {}, prBody: '', app: 'velo', changedFiles: [] }).surfaces[0].path, '/')
})

// #3957: the workflow_run capture has no PR_BODY, so the body is read from the API by --pr.
function stubFetch(res) {
  const calls = []
  const fn = async (url, opts) => {
    calls.push({ url, opts })
    if (res instanceof Error) throw res
    return res
  }
  return { fn, calls }
}
const ok = body => ({ ok: true, status: 200, json: async () => ({ body }) })
const MARKER = '<!-- review-surface: crouton-builder /builder/a -->'

test('readPrBody: a non-empty PR_BODY is used without fetching; an empty one fetches', async () => {
  const a = stubFetch(ok('x'))
  assert.equal(await readPrBody({ env: { PR_BODY: 'given', REPO: 'o/r', GH_TOKEN: 't' }, pr: '12', fetchFn: a.fn }), 'given')
  assert.equal(a.calls.length, 0)
  const b = stubFetch(ok('fetched'))
  assert.equal(await readPrBody({ env: { PR_BODY: '', REPO: 'o/r', GH_TOKEN: 't' }, pr: '12', fetchFn: b.fn }), 'fetched')
  assert.equal(b.calls.length, 1)
})

test('readPrBody: GETs /repos/<repo>/pulls/<pr> with a Bearer token and returns the body', async () => {
  const s = stubFetch(ok(MARKER))
  const body = await readPrBody({ env: { REPO: 'o/r', GH_TOKEN: 't' }, pr: '12', fetchFn: s.fn })
  assert.equal(body, MARKER)
  assert.equal(s.calls[0].url, 'https://api.github.com/repos/o/r/pulls/12')
  assert.equal(s.calls[0].opts.headers.Authorization, 'Bearer t')
})

test('readPrBody: a PR with a null body returns an empty string', async () => {
  const s = stubFetch(ok(null))
  assert.equal(await readPrBody({ env: { REPO: 'o/r', GH_TOKEN: 't' }, pr: '12', fetchFn: s.fn }), '')
})

test('readPrBody: a 404, a throwing fetch and a missing token all reject', async () => {
  const env = { REPO: 'o/r', GH_TOKEN: 't' }
  await assert.rejects(readPrBody({ env, pr: '12', fetchFn: stubFetch({ ok: false, status: 404 }).fn }), /PR #12.*404/)
  await assert.rejects(readPrBody({ env, pr: '12', fetchFn: stubFetch(new Error('network down')).fn }), /PR #12.*network down/)
  const s = stubFetch(ok(MARKER))
  await assert.rejects(readPrBody({ env: { REPO: 'o/r' }, pr: '12', fetchFn: s.fn }), /PR #12.*no repo\/token/)
  assert.equal(s.calls.length, 0)
})

test('pickSurfaces: the marker read from the API is the declared surface; a failed read rejects', async () => {
  const env = { REPO: 'o/r', GH_TOKEN: 't' }
  const args = { pr: '12', app: 'crouton-builder' }
  const r = await pickSurfaces({ env, args, manifest: {}, fetchFn: stubFetch(ok(MARKER)).fn })
  assert.equal(r.reason, 'declared on the PR')
  assert.equal(r.surfaces[0].path, '/builder/a')
  await assert.rejects(pickSurfaces({ env, args, manifest: {}, fetchFn: stubFetch({ ok: false, status: 404 }).fn }), /404/)
})

// #4141: the screenshot job checks out MAIN, so a reviewTeam the PR adds is missing from its
// manifest. The team the deploy seeded travels in preview-meta and arrives as --team.
test('#4141 pickSurfaces: metadata team kdm wins over a checked-out manifest with no reviewTeam', async () => {
  const env = { REPO: 'o/r', GH_TOKEN: 't', CHANGED_FILES: 'pocs/kdm/app/pages/admin/[team]/workspace.vue' }
  const r = await pickSurfaces({ env, args: { pr: '12', app: 'kdm', team: 'kdm' }, manifest: {}, fetchFn: stubFetch(ok('Closes #1')).fn })
  assert.deepEqual(r.surfaces.map(s => s.path), ['/admin/kdm/workspace'])
  const declared = await pickSurfaces({ env, args: { pr: '12', app: 'kdm', team: 'kdm' }, manifest: {}, fetchFn: stubFetch(ok('<!-- review-surface: kdm /admin/{team}/workspace -->')).fn })
  assert.equal(declared.surfaces[0].path, '/admin/kdm/workspace')
  // the deployed team also beats a stale manifest value; no --team (older record) → manifest fallback
  const stale = await pickSurfaces({ env, args: { pr: '12', app: 'kdm', team: 'kdm' }, manifest: { reviewTeam: 'old' }, fetchFn: stubFetch(ok('')).fn })
  assert.deepEqual(stale.surfaces.map(s => s.path), ['/admin/kdm/workspace'])
  const legacy = await pickSurfaces({ env, args: { pr: '12', app: 'kdm' }, manifest: { reviewTeam: 'old' }, fetchFn: stubFetch(ok('')).fn })
  assert.deepEqual(legacy.surfaces.map(s => s.path), ['/admin/old/workspace'])
  // an older record has no team, so the job passes `--team ""` → still the manifest fallback
  const empty = await pickSurfaces({ env, args: { pr: '12', app: 'kdm', team: '' }, manifest: { reviewTeam: 'old' }, fetchFn: stubFetch(ok('')).fn })
  assert.deepEqual(empty.surfaces.map(s => s.path), ['/admin/old/workspace'])
})

test('#4141 wiring: the deploy records the seeded team and the screenshot job passes it as --team', () => {
  const deploy = readFileSync(new URL('../.github/workflows/deploy-app.yml', import.meta.url), 'utf8')
  const record = deploy.slice(deploy.indexOf('- name: Record preview for the screenshot check'), deploy.indexOf('- name: Upload preview record'))
  assert.match(record, /REVIEW_TEAM: \$\{\{ steps\.review_team\.outputs\.team \}\}/)
  assert.match(record, /team:\$team\}/)
  const shot = readFileSync(new URL('../.github/workflows/preview-screenshot.yml', import.meta.url), 'utf8')
  assert.match(shot, /capture-review-surfaces\.mjs[^\n]*\n[^\n]*--team "\$\(jq -r '\.team \/\/ ""' "\$META"\)"/)
  // the screenshot job still must not check out PR code
  assert.doesNotMatch(shot, /ref:\s*\$\{\{\s*github\.event\.(pull_request|workflow_run)\.head/)
})

// ── settlePage (#4134): wait for the draw first, reload only a page still loading ──────────
// A fake page + fake clock; the REAL isLoading runs against page.content()/page.evaluate().
function fakeSettle({ states, drawAfterMs = Infinity, drawText = 'x'.repeat(400) }) {
  // states[i] = { html, text } for load i (0 = goto, 1 = first reload, …); last one repeats.
  const clock = { t: 0 }
  let load = 0
  let loadedAt = 0
  let drawn = false
  const cur = () => states[Math.min(load, states.length - 1)]
  const sleeps = []
  const page = {
    content: async () => cur().html,
    evaluate: async () => (drawn ? drawText : cur().text).trim().length,
    reload: async () => {
      load++
      loadedAt = clock.t
      drawn = false
      return { status: () => 200 + load }
    }
  }
  // Fake draw-wait: advance the clock until the page draws or the 30s bound; a loader exits early.
  const waitDrawn = async () => {
    if (cur().html.toLowerCase().includes('__nuxt_loading__')) return
    if (cur().text.trim().length > 50) return
    const drawAt = loadedAt + drawAfterMs
    if (drawAt - clock.t > 30000) {
      clock.t += 30000
      return
    }
    clock.t = Math.max(clock.t, drawAt)
    drawn = true
  }
  const sleep = async (ms) => {
    sleeps.push(ms)
    clock.t += ms
  }
  const opts = { deadline: 300_000, now: () => clock.t, sleep, waitDrawn, status: 200 }
  return { page, clock, sleeps, opts }
}
const SHELL = { html: '<div id="__nuxt">RT Pages Workspace Drafts</div>', text: 'RT\nPages Workspace\nDrafts' }
const LOADER = { html: '<div id="__nuxt_loading__">loading</div>', text: 'Loading' }
const FULL = { html: '<div id="__nuxt">…</div>', text: 'x'.repeat(400) }

// covers: T1
test('settlePage: a 25-char SSR shell that draws 5s later settles with no reload (#4134)', async () => {
  const f = fakeSettle({ states: [SHELL], drawAfterMs: 5000 })
  const r = await settlePage(f.page, f.opts)
  assert.equal(r.loading, false)
  assert.equal(r.reloads, 0)
  assert.equal(f.clock.t, 5000)
})

// covers: T2
test('settlePage: a page stuck on Nuxt\'s loader is still loading at the deadline, within budget (#4134)', async () => {
  const f = fakeSettle({ states: [LOADER] })
  const r = await settlePage(f.page, f.opts)
  assert.equal(r.loading, true)
  assert.ok(r.reloads > 0)
  // the loader exits the draw-wait early, so one iteration costs only the 3s sleep
  assert.ok(f.clock.t <= f.opts.deadline + 3000, `clock ${f.clock.t} past deadline + one iteration`)
})

// covers: T3
test('settlePage: a cold-start loader then real content is captured after one reload (#2526)', async () => {
  const f = fakeSettle({ states: [LOADER, FULL] })
  const r = await settlePage(f.page, f.opts)
  assert.equal(r.loading, false)
  assert.equal(r.reloads, 1)
  assert.equal(r.status, 201) // taken from the reload response
})

// covers: T4
test('settlePage: a server-rendered 400-char page settles at once with no sleep', async () => {
  const f = fakeSettle({ states: [FULL] })
  const r = await settlePage(f.page, f.opts)
  assert.equal(r.loading, false)
  assert.equal(r.reloads, 0)
  assert.equal(r.status, 200)
  assert.deepEqual(f.sleeps, [])
})

// The REAL waitForHydration predicate, run once by a fake page.waitForFunction against a
// stubbed globalThis.document/window (the predicate is self-contained, as Playwright needs).
async function runHydrationPredicate({ outerHTML, rootText, nuxtApp }) {
  const saved = { document: globalThis.document, window: globalThis.window }
  const call = {}
  globalThis.document = {
    documentElement: { outerHTML },
    querySelector: sel => (sel === '#__nuxt' && rootText != null ? { innerText: rootText } : null)
  }
  globalThis.window = nuxtApp ? { useNuxtApp: () => nuxtApp } : {}
  try {
    const page = {
      waitForFunction: async (fn, arg, opts) => {
        call.arg = arg
        call.opts = opts
        call.result = fn(arg)
      }
    }
    await waitForHydration(page)
  } finally {
    globalThis.document = saved.document
    globalThis.window = saved.window
  }
  return call
}

// covers: T5
test('waitForHydration: real predicate exits early on a loader, waits on a short shell, passes drawn hydrated content; 30s bound (#4134)', async () => {
  const loader = await runHydrationPredicate({ outerHTML: '<html><body><div id="__nuxt_loading__"></div></body></html>', rootText: null })
  assert.ok(loader.result, 'a loader marker stops the wait at once')
  assert.deepEqual(loader.arg, LOADING_MARKERS, 'the shared marker list is passed in, not a copy')
  assert.equal(loader.opts.timeout, 30000)

  const shell = await runHydrationPredicate({ outerHTML: '<div id="__nuxt">x</div>', rootText: 'RT\nPages Workspace\nDrafts', nuxtApp: { isHydrating: true } })
  assert.equal(shell.result, false, 'a 25-char #__nuxt keeps waiting')

  const drawn = await runHydrationPredicate({ outerHTML: '<div id="__nuxt">x</div>', rootText: 'x'.repeat(60), nuxtApp: { isHydrating: false } })
  assert.equal(drawn.result, true, 'a 60-char hydrated #__nuxt is done')
})

// ── #4201: shoot the changed screen, or go red ────────────────────────────────

test('resolveSurfaces: a PR that changes a screen and names no page gets no start-page shot (#4201)', () => {
  const vue = ['packages/crouton-core/app/components/X.vue']
  const none = resolveSurfaces({ manifest: {}, prBody: '', app: 'kassa', changedFiles: vue })
  assert.deepEqual(none.surfaces, [])
  assert.ok(none.reason.startsWith('no screenshot of the changed screen'), none.reason)

  const scripts = resolveSurfaces({ manifest: {}, prBody: '', app: 'kassa', changedFiles: ['scripts/x.mjs'] })
  assert.deepEqual(scripts.surfaces.map(s => s.path), ['/'])
  assert.equal(scripts.reason, 'start page — this PR changes no screen')

  const optedOut = resolveSurfaces({ manifest: {}, prBody: 'x <!-- review-surface-none -->', app: 'kassa', changedFiles: vue })
  assert.deepEqual(optedOut.surfaces.map(s => s.path), ['/'])

  const declared = resolveSurfaces({ manifest: {}, prBody: '<!-- review-surface: kassa /admin/test1/x -->', app: 'kassa', changedFiles: vue })
  assert.deepEqual(declared.surfaces.map(s => s.path), ['/admin/test1/x'])
  assert.equal(declared.reason, 'declared on the PR')
})

test('changesScreen: VISUAL_PATH files outside fixtures/ and e2e/ (#4201)', () => {
  assert.equal(changesScreen(['a/b.vue']), true)
  assert.equal(changesScreen(['fixtures/x/app/pages/a.vue', 'e2e/a.vue', 'scripts/a.mjs']), false)
  assert.equal(changesScreen(undefined), false)
})

test('deriveSurfaces: a package page only for apps that use its package (#4151, #4201)', () => {
  const changedFiles = ['packages/crouton-assets/app/pages/admin/[team]/media.vue', 'packages/crouton-events/app/pages/admin/[team]/activity.vue']
  assert.deepEqual(deriveSurfaces({ changedFiles, app: 'kassa', packages: ['crouton-core'] }), [])
  assert.deepEqual(deriveSurfaces({ changedFiles, app: 'velo', packages: ['crouton-core', 'crouton-assets'] }).map(s => s.path), ['/admin/test1/media'])
  assert.deepEqual(deriveSurfaces({ changedFiles, app: 'kassa' }).map(s => s.path), ['/admin/test1/media', '/admin/test1/activity'])
  assert.ok(!appPackages('kassa', 'apps').includes('crouton-assets'))
  assert.ok(appPackages('velo', 'apps').includes('crouton-assets'))
  assert.equal(appPackages('no-such-app', 'apps'), undefined)
})

test('pickSurfaces: reads the app\'s package list from the manifest\'s workspace (#4151, #4201)', async () => {
  const env = { PR_BODY: 'body', CHANGED_FILES: 'packages/crouton-assets/app/pages/admin/[team]/media.vue' }
  const kassa = await pickSurfaces({ env, args: { pr: 1, app: 'kassa', manifest: 'apps/kassa/deploy.config.json' }, manifest: {} })
  assert.deepEqual(kassa.surfaces, [])
  const velo = await pickSurfaces({ env, args: { pr: 1, app: 'velo', manifest: 'apps/velo/deploy.config.json' }, manifest: {} })
  assert.deepEqual(velo.surfaces.map(s => s.path), ['/admin/test1/media'])
})

test('landingRejection: named/guessed pages must stay put, the start page may redirect (#4201)', () => {
  const [declared] = resolveSurfaces({ manifest: {}, prBody: '<!-- review-surface: velo /admin/test1/media -->', app: 'velo', changedFiles: [] }).surfaces
  assert.equal(landingRejection(declared, 'https://h/auth/login?redirect=x'), 'landed on /auth/login instead of /admin/test1/media')
  const [start] = resolveSurfaces({ manifest: {}, prBody: '', app: 'crate', changedFiles: [] }).surfaces
  assert.equal(landingRejection(start, 'https://h/crate/test1'), null)
  const [guessed] = resolveSurfaces({ manifest: {}, prBody: '', app: 'velo', changedFiles: ['apps/velo/app/pages/admin/[team]/media.vue'] }).surfaces
  assert.equal(landingRejection(guessed, 'https://h/admin/test1/media/'), null)
})

test('landingRejection still rejects a signed-out /auth/login that lands on / (#4235, case 7)', () => {
  assert.equal(landingRejection({ path: '/auth/login', checkLanding: true }, 'https://h/'), 'landed on / instead of /auth/login')
})

// #4248 — every page is tried signed in first; an /auth/ page that is sent away gets one signed-out try.
const consent = { name: 'auth-consent', path: '/auth/consent', checkLanding: true }
const login = { name: 'auth-login', path: '/auth/login', checkLanding: true }

test('authTryDecision T1: /auth/consent that stays put signed in is kept signed in, no retry (#4248 case 1)', () => {
  assert.deepEqual(authTryDecision(consent, [{ url: 'https://h/auth/consent' }]), { keep: 'signed-in' })
})

test('authTryDecision T2: /auth/login sent to / signed in is retried, then kept signed out (#4248 case 2)', () => {
  const t1 = { url: 'https://h/', session: true }
  assert.deepEqual(authTryDecision(login, [t1]), { retry: 'signed-out' })
  assert.deepEqual(authTryDecision(login, [t1, { url: 'https://h/auth/login', dialogForm: false }]), { keep: 'signed-out' })
})

test('authTryDecision T3: a sign-in page shown as a pop-up on / is kept (#4248 case 3)', () => {
  assert.deepEqual(
    authTryDecision(login, [{ url: 'https://h/', session: true }, { url: 'https://h/', dialogForm: true }]),
    { keep: 'signed-out', popup: true }
  )
})

test('authTryDecision T4: a pop-up on / never counts for /auth/consent (#4248 case 4)', () => {
  const d = authTryDecision(consent, [{ url: 'https://h/auth/login' }, { url: 'https://h/', dialogForm: true }])
  assert.ok(d.reject, 'rejected')
  assert.match(d.reject, /\/auth\/consent/)
  assert.equal(d.keep, undefined)
})

test('authTryDecision T5: a non-/auth page that lands on /auth/login is rejected with no retry (#4248 case 5)', () => {
  const team = { name: 'team', path: '/admin/test1/team', checkLanding: true }
  assert.deepEqual(authTryDecision(team, [{ url: 'https://h/auth/login?redirect=x' }]), { reject: 'landed on /auth/login instead of /admin/test1/team' })
})

test('authTryDecision T6: in one run, /auth/login is kept signed out and /auth/consent signed in (#4248 case 6)', () => {
  const decisions = [login, consent].map((s) => {
    const landings = { '/auth/login': ['https://h/', 'https://h/auth/login'], '/auth/consent': ['https://h/auth/consent'] }[s.path]
    const t1 = { url: landings[0], session: true }
    const d = authTryDecision(s, [t1])
    return d.retry ? authTryDecision(s, [t1, { url: landings[1], dialogForm: false }]) : d
  })
  assert.deepEqual(decisions, [{ keep: 'signed-out' }, { keep: 'signed-in' }])
})

test('authTryDecision T7: when the review login failed (signed-in try shows the pop-up too), consent is rejected (#4248 case 7)', () => {
  const d = authTryDecision(consent, [{ url: 'https://h/', session: false }, { url: 'https://h/', dialogForm: true }])
  assert.ok(d.reject, 'rejected')
  assert.match(d.reject, /\/auth\/consent/)
})

// #4265 — a sign-in form on the signed-in try proves nothing; the app's session decides.
test('#4265 T1: /auth/login kept as a pop-up when the signed-in try had a session, whatever form it showed', () => {
  const out = { url: 'https://h/', dialogForm: true }
  assert.deepEqual(authTryDecision(login, [{ url: 'https://h/', session: true, dialogForm: true }, out]), { keep: 'signed-out', popup: true })
  assert.deepEqual(authTryDecision(login, [{ url: 'https://h/', session: true, dialogForm: 'search-form' }, out]), { keep: 'signed-out', popup: true })
})

test('#4265 T2: /auth/login pop-up rejected as a failed review login when the signed-in try had no session', () => {
  const d = authTryDecision(login, [{ url: 'https://h/', session: false, dialogForm: true }, { url: 'https://h/', dialogForm: true }])
  assert.ok(d.reject, 'rejected')
  assert.match(d.reject, /review login did not work/)
  assert.doesNotMatch(d.reject, /is not \/auth\/login/)
})

test('#4265 T3: sessionFromResponse is true only for a 2xx answer with a user', () => {
  assert.equal(sessionFromResponse(200, { user: { id: 'u' }, session: {} }), true)
  assert.equal(sessionFromResponse(200, null), false)
  assert.equal(sessionFromResponse(200, {}), false)
  assert.equal(sessionFromResponse(200, undefined), false)
  assert.equal(sessionFromResponse(401, { user: { id: 'u' } }), false)
  assert.equal(sessionFromResponse(404, undefined), false)
})

test('#4265 case 3: consent sent to /auth/login signed in, pop-up on / signed out, is still rejected', () => {
  const d = authTryDecision(consent, [{ url: 'https://h/auth/login', session: true }, { url: 'https://h/', dialogForm: true }])
  assert.ok(d.reject, 'rejected')
  assert.equal(d.keep, undefined)
  assert.match(d.reject, /is not \/auth\/consent/)
})

test('T8: the old fixed "/auth/ ⇒ signed out" rule is gone; isAuthPath only says "under /auth" (#4248)', () => {
  assert.equal(captureModule.splitBySession, undefined)
  assert.equal(captureModule.signInModalLanding, undefined)
  assert.equal(captureModule.needsSignedOut, undefined)
  assert.equal(isAuthPath('/auth/consent'), true)
  assert.equal(isAuthPath('/auth'), true)
  assert.equal(isAuthPath('/auth-ish/x'), false)
  assert.equal(isAuthPath('/'), false)
})


// ── #4252: "no screen to check" wins over guessed pages, but only with a reason ──────────────

test('noneReason: only the marker that carries a reason (#4252)', () => {
  assert.equal(noneReason('x <!-- review-surface-none: the consent screen only shows mid sign-in --> y'), 'the consent screen only shows mid sign-in')
  assert.equal(noneReason('<!--review-surface-none:   spaced   out  -->'), 'spaced out')
  assert.equal(noneReason('<!-- review-surface-none -->'), '')
  assert.equal(noneReason('<!-- review-surface-none:    -->'), '')
  assert.equal(noneReason('<!-- review-surface: kassa /x -->'), '')
  assert.equal(noneReason(''), '')
  assert.equal(noneReason(undefined), '')
})

test('resolveSurfaces: a reasoned "no screen to check" beats guessed pages; a bare one does not (#4252)', () => {
  const changedFiles = ['packages/crouton-auth/app/pages/auth/login.vue']
  const guessed = resolveSurfaces({ manifest: {}, prBody: '', app: 'kassa', changedFiles })
  assert.deepEqual(guessed.surfaces.map(s => s.path), ['/auth/login'])

  const bare = resolveSurfaces({ manifest: {}, prBody: '<!-- review-surface-none -->', app: 'kassa', changedFiles })
  assert.deepEqual(bare.surfaces.map(s => s.path), ['/auth/login'], 'no reason: the guess still counts')

  const reasoned = resolveSurfaces({ manifest: {}, prBody: '<!-- review-surface-none: only shows mid sign-in -->', app: 'kassa', changedFiles })
  assert.deepEqual(reasoned.surfaces.map(s => s.path), ['/'])
  assert.equal(reasoned.reason, 'no screen to check: only shows mid sign-in')
  assert.ok(reasoned.surfaces.every(s => s.name.startsWith('no-screen-')), 'the picture name says why it is the start page')
  assert.ok(reasoned.surfaces.every(s => !s.checkLanding), 'the start page may redirect, as for a PR that changes no screen')
})

test('resolveSurfaces: a page the PR names beats a reasoned "no screen to check" (#4252)', () => {
  const body = '<!-- review-surface: kassa /admin/test1/x -->\n<!-- review-surface-none: nothing to see -->'
  const r = resolveSurfaces({ manifest: {}, prBody: body, app: 'kassa', changedFiles: ['packages/crouton-auth/app/pages/auth/login.vue'] })
  assert.deepEqual(r.surfaces.map(s => s.path), ['/admin/test1/x'])
  assert.equal(r.reason, 'declared on the PR')
})

test('resolveSurfaces: a reasoned "no screen to check" keeps the manifest\'s own pages (#4252)', () => {
  const manifest = { reviewSurfaces: [{ name: 'home', path: '/dashboard' }] }
  const r = resolveSurfaces({ manifest, prBody: '<!-- review-surface-none: scripts only -->', app: 'kassa', changedFiles: ['packages/crouton-core/app/components/X.vue'] })
  assert.deepEqual(r.surfaces.map(s => [s.name, s.path]), [['no-screen-home', '/dashboard']])
})
