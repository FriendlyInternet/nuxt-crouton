/**
 * #1769 contract — the app↔package schema drift ratchet.
 *
 * The case that minted it: kassa's `products.json` lacked the `required: true` that the
 * package's carried on `categoryId`/`locationId`. The generated column came out nullable, a
 * product with no prep location was reachable through the normal UI, and its order items
 * routed to no kitchen screen at all (#1766). A text diff would have found it — and would
 * also have screamed about 178 lines of deliberate customisation in triage's `pages.json`.
 * These tests pin the distinction that makes the check usable: behavioural vs cosmetic.
 *
 *   node --test scripts/check-schema-drift.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { compareSchemas, normalizeSchema, normalizeDef, assessPair, buildBaseline } from './check-schema-drift.mjs'

/** The real #1769 shape, reduced to the two fields that mattered. */
const PACKAGE_PRODUCTS = {
  id: { type: 'uuid', meta: { primaryKey: true } },
  categoryId: { type: 'uuid', refTarget: 'categories', meta: { required: true, label: 'Category' } },
  locationId: { type: 'uuid', refTarget: 'locations', meta: { required: true, label: 'Prep Location' } },
}
const KASSA_PRODUCTS = {
  id: { type: 'uuid', meta: { primaryKey: true } },
  categoryId: { type: 'uuid', refTarget: 'categories', meta: { label: 'Category' } },
  locationId: { type: 'uuid', refTarget: 'locations', meta: { label: 'Prep Location' } },
}

test('the #1769 divergence is caught, and named per field', () => {
  const { behavioural } = compareSchemas(KASSA_PRODUCTS, PACKAGE_PRODUCTS)
  assert.deepEqual(behavioural.map(d => d.path), ['categoryId.required', 'locationId.required'])
  assert.equal(behavioural[0].consumer, undefined)
  assert.equal(behavioural[0].package, true)
})

test('identical copies are clean', () => {
  const { behavioural, cosmetic } = compareSchemas(PACKAGE_PRODUCTS, PACKAGE_PRODUCTS)
  assert.deepEqual(behavioural, [])
  assert.deepEqual(cosmetic, [])
})

test('wording differences are cosmetic, never behavioural', () => {
  const reworded = { ...PACKAGE_PRODUCTS, locationId: { type: 'uuid', refTarget: 'locations', meta: { required: true, label: 'Prep Location', helpText: 'Which station makes it' } } }
  const { behavioural, cosmetic } = compareSchemas(reworded, PACKAGE_PRODUCTS)
  assert.deepEqual(behavioural, [])
  assert.deepEqual(cosmetic.map(d => d.path), ['locationId.helpText'])
})

test('a type change is behavioural — it changes the generated column', () => {
  const retyped = { ...PACKAGE_PRODUCTS, locationId: { type: 'string', refTarget: 'locations', meta: { required: true, label: 'Prep Location' } } }
  assert.deepEqual(compareSchemas(retyped, PACKAGE_PRODUCTS).behavioural.map(d => d.path), ['locationId.type'])
})

test('extra and missing fields are behavioural, marked + and -', () => {
  const { behavioural } = compareSchemas({ id: PACKAGE_PRODUCTS.id, extra: { type: 'string' } }, PACKAGE_PRODUCTS)
  assert.deepEqual(behavioural.map(d => d.path).sort(), ['+extra', '-categoryId', '-locationId'])
})

test('an unknown meta key is behavioural — the ratchet fails toward demanding a declaration', () => {
  const odd = { ...PACKAGE_PRODUCTS, id: { type: 'uuid', meta: { primaryKey: true, someNewGeneratorFlag: true } } }
  assert.deepEqual(compareSchemas(odd, PACKAGE_PRODUCTS).behavioural.map(d => d.path), ['id.someNewGeneratorFlag'])
})

test('key order is not a difference', () => {
  const reordered = { locationId: PACKAGE_PRODUCTS.locationId, id: PACKAGE_PRODUCTS.id, categoryId: PACKAGE_PRODUCTS.categoryId }
  assert.deepEqual(compareSchemas(reordered, PACKAGE_PRODUCTS).behavioural, [])
})

// --- the three on-disk shapes ------------------------------------------------------------

test('normalizeSchema reads flat, wrapper+object and wrapper+array alike', () => {
  const flat = normalizeSchema({ title: { type: 'string' } })
  assert.deepEqual(flat.fields, { title: { type: 'string' } })
  assert.deepEqual(flat.wrapper, {})

  const wrapped = normalizeSchema({ name: 'pages', label: 'Pages', fields: { title: { type: 'string' } } })
  assert.deepEqual(wrapped.fields, { title: { type: 'string' } })
  assert.equal(wrapped.wrapper.name, 'pages')

  const arr = normalizeSchema({ name: 'pages', fields: [{ name: 'title', type: 'string', required: true }] })
  assert.deepEqual(arr.fields, { title: { type: 'string', required: true } })
})

test('an array schema keys on name, so reordering fields is not drift', () => {
  const a = { fields: [{ name: 'title', type: 'string' }, { name: 'slug', type: 'string' }] }
  const b = { fields: [{ name: 'slug', type: 'string' }, { name: 'title', type: 'string' }] }
  assert.deepEqual(compareSchemas(a, b).behavioural, [])
})

test('nested meta and flattened meta compare as the same fact', () => {
  assert.deepEqual(normalizeDef({ type: 'string', meta: { required: true } }), { type: 'string', required: true })
  const nested = { title: { type: 'string', meta: { required: true, maxLength: 100 } } }
  const flatDef = { fields: [{ name: 'title', type: 'string', required: true, maxLength: 100 }] }
  assert.deepEqual(compareSchemas(flatDef, nested).behavioural, [])
})

test('a differing enum option set is behavioural', () => {
  const consumer = { fields: [{ name: 'visibility', type: 'string', options: [{ value: 'public' }] }] }
  const pkg = { fields: [{ name: 'visibility', type: 'string', options: [{ value: 'public' }, { value: 'admin' }] }] }
  assert.deepEqual(compareSchemas(consumer, pkg).behavioural.map(d => d.path), ['visibility.options'])
})

test('wrapper prose is cosmetic but hierarchy config is not', () => {
  const a = { name: 'pages', label: 'Pagina\'s', hierarchy: { enabled: true }, fields: {} }
  const b = { name: 'pages', label: 'Pages', hierarchy: { enabled: false }, fields: {} }
  const { behavioural, cosmetic } = compareSchemas(a, b)
  assert.deepEqual(behavioural.map(d => d.path), ['$hierarchy'])
  assert.deepEqual(cosmetic.map(d => d.path), ['$label'])
})

// --- the ratchet -------------------------------------------------------------------------

const pairOf = (consumerJson, entry) => assessPair({
  consumer: 'apps/kassa/schemas/products.json',
  packageFile: 'packages/crouton-sales/schemas/products.json',
  diffs: compareSchemas(consumerJson, PACKAGE_PRODUCTS),
  entry,
})

test('undeclared behavioural drift fails', () => {
  assert.equal(pairOf(KASSA_PRODUCTS, undefined).status, 'undeclared')
})

test('declaring every diverging field passes', () => {
  const r = pairOf(KASSA_PRODUCTS, { fields: ['categoryId.required', 'locationId.required'], reason: 'why' })
  assert.equal(r.status, 'declared')
  assert.deepEqual(r.new, [])
})

test('a NEW divergence on an already-declared pair still fails — that is the ratchet', () => {
  const r = pairOf(KASSA_PRODUCTS, { fields: ['categoryId.required'], reason: 'why' })
  assert.equal(r.status, 'new')
  assert.deepEqual(r.new, ['locationId.required'])
})

test('reconciling a declared field is stale, not a failure — converging must never turn CI red', () => {
  const r = pairOf(PACKAGE_PRODUCTS, { fields: ['categoryId.required'], reason: 'why' })
  assert.equal(r.status, 'clean')
  assert.deepEqual(r.stale, ['categoryId.required'])
})

test('a clean pair with no entry is clean', () => {
  assert.equal(pairOf(PACKAGE_PRODUCTS, undefined).status, 'clean')
})

test('buildBaseline keeps reasons already written and drops reconciled pairs', () => {
  const results = [
    pairOf(KASSA_PRODUCTS, undefined),
    { ...pairOf(PACKAGE_PRODUCTS, undefined), consumer: 'apps/velo/schemas/pages.json' },
  ]
  const next = buildBaseline(results, { 'apps/kassa/schemas/products.json': { reason: 'deliberate, see #1769' } })
  assert.equal(next['apps/kassa/schemas/products.json'].reason, 'deliberate, see #1769')
  assert.deepEqual(next['apps/kassa/schemas/products.json'].fields, ['categoryId.required', 'locationId.required'])
  assert.ok(!('apps/velo/schemas/pages.json' in next), 'a pair with no behavioural drift is not baselined')
})

test('a pair with no prior reason is flagged UNREVIEWED rather than silently blessed', () => {
  const next = buildBaseline([pairOf(KASSA_PRODUCTS, undefined)], {})
  assert.match(next['apps/kassa/schemas/products.json'].reason, /UNREVIEWED/)
})
