import { test } from 'node:test'
import assert from 'node:assert/strict'
import { slug, outName, parseSurfaces, parseAction, isFlatFrame, parsePrSurfaces, resolveSurfaces } from './capture-review-surfaces.mjs'

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

// #2433 — the PR (copied from its issue) names the page that shows the change. Without it the
// capture shot each app's fixed landing page, and that unrelated screenshot satisfied the
// sign-off gate (#2420: the kassa POS launcher, for a page-editor change).
const HOLD = '<!-- deploy-preview: full-watch -->'
const EDITOR = '<!-- review-surface: kassa /admin/test1/workspace?page=seed:page:test1:vlaamsekermis name:editor wait:2500 -->'

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

test('isFlatFrame: rejects the committed all-white 390px capture (#2526)', async () => {
  const { default: sharp } = await import('sharp')
  const file = new URL('./lib/__fixtures__/blank-white-390.png', import.meta.url)
  const { data, info } = await sharp(file.pathname).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  assert.equal(isFlatFrame({ data, width: info.width, height: info.height, channels: info.channels }), true)
})
