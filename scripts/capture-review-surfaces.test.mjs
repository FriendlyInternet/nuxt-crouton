import { test } from 'node:test'
import assert from 'node:assert/strict'
import { slug, outName, parseSurfaces, parseAction, isFlatFrame } from './capture-review-surfaces.mjs'

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
    { name: 'Data', path: '/admin/y' },              // same name → de-duped
    { path: '/admin/z' },                            // no name → surface-3
    { name: 'skip', path: '' },                      // no path → dropped
    null,                                            // junk → dropped
  ] }
  const s = parseSurfaces(m)
  assert.equal(s.length, 3)
  assert.deepEqual(s[0], { name: 'data', path: '/admin/x', do: ['click:.tab', 'wait:500'] })
  assert.notEqual(s[1].name, s[0].name)             // de-duped, not overwriting the file
  assert.equal(s[2].name, 'surface-3')
  assert.deepEqual(s[2].do, [])                     // do defaults to []
})

test('parseSurfaces: falls back to reviewLogin.landing, then "/"', () => {
  assert.deepEqual(parseSurfaces({ reviewLogin: { landing: '/admin/test1/sales' } }),
    [{ name: 'preview', path: '/admin/test1/sales', do: [] }])
  assert.deepEqual(parseSurfaces({}), [{ name: 'preview', path: '/', do: [] }])
  assert.deepEqual(parseSurfaces({ reviewSurfaces: [] }), [{ name: 'preview', path: '/', do: [] }])
})

test('parseAction: click / wait / unknown; wait clamped', () => {
  assert.deepEqual(parseAction('click:[data-review=tab]'), { verb: 'click', selector: '[data-review=tab]' })
  assert.deepEqual(parseAction("click:[aria-label='Filters']"), { verb: 'click', selector: "[aria-label='Filters']" })
  assert.deepEqual(parseAction('wait:800'), { verb: 'wait', ms: 800 })
  assert.deepEqual(parseAction('wait:99999'), { verb: 'wait', ms: 15000 })   // clamped
  assert.deepEqual(parseAction('wait:-5'), { verb: 'wait', ms: 0 })
  assert.equal(parseAction('frobnicate:x').verb, 'unknown')
})

test('isFlatFrame: a single-colour frame is flat (blank), a varied one is not', () => {
  const flat = { width: 8, height: 8, channels: 4, data: new Uint8ClampedArray(8 * 8 * 4).fill(255) }
  assert.equal(isFlatFrame(flat), true)
  // a frame with a clearly different quadrant is NOT flat
  const varied = new Uint8ClampedArray(8 * 8 * 4).fill(255)
  for (let y = 0; y < 4; y++) for (let x = 0; x < 8; x++) {
    const idx = (y * 8 + x) * 4
    varied[idx] = 0; varied[idx + 1] = 0; varied[idx + 2] = 0
  }
  assert.equal(isFlatFrame({ width: 8, height: 8, channels: 4, data: varied }), false)
})
