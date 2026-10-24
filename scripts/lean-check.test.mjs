/**
 * lean-check.test.mjs — pure-helper tests for the report-only leanness check (#2190).
 *
 *   node --test scripts/lean-check.test.mjs
 *
 * Every case drives the PURE exported helpers with literals (no git, no fs), so the test is
 * deterministic. Two cases are load-bearing per the issue:
 *   • the #2186 REGRESSION — removing the last caller of `sales.events.openPos` and the last
 *     link to `/order` surfaces BOTH the key and the page;
 *   • the DYNAMIC-KEY false-positive counterpart (#1957) — a key reached only via a dynamic
 *     `t('a.b.' + x)` prefix is NOT flagged.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  flattenKeys,
  staticKeyCalls,
  dynamicKeyPrefixes,
  isCoveredByPrefix,
  orphanedKeyCandidates,
  isAllDynamicRoute,
  routeIsReferenced,
  strandedPageCandidates,
  removedLines,
  routeForPageFile,
  extractRouteLinks,
  parseArgs,
} from './lean-check.mjs'

test('flattenKeys produces dotted paths and treats arrays as leaves', () => {
  assert.deepEqual(
    flattenKeys({ a: { b: 1, c: { d: 2 } }, e: [1, 2] }).sort(),
    ['a.b', 'a.c.d', 'e'],
  )
})

test('staticKeyCalls captures t()/$t() string literals, not dynamic ones', () => {
  const text = `t('a.b') $t("c.d") t(\`e.f\`) t('x.' + y) t(\`p.\${z}\`)`
  assert.deepEqual([...staticKeyCalls(text)].sort(), ['a.b', 'c.d', 'e.f'])
})

test('dynamicKeyPrefixes recovers the static prefix of concat and template calls', () => {
  const text = `t('sales.events.' + name) t(\`admin.\${key}\`)`
  assert.deepEqual([...dynamicKeyPrefixes(text)].sort(), ['admin.', 'sales.events.'])
})

test('isCoveredByPrefix matches only real prefixes', () => {
  assert.equal(isCoveredByPrefix('sales.events.openPos', new Set(['sales.events.'])), true)
  assert.equal(isCoveredByPrefix('sales.other.x', new Set(['sales.events.'])), false)
  assert.equal(isCoveredByPrefix('any', new Set([''])), false) // empty prefix never matches
})

// ── The #2186 regression: last caller removed → key AND page both surface ────────────────────
test('#2186 regression — orphaned key + stranded page both surface', () => {
  // The removed button called t('sales.events.openPos') and linked to='/order'.
  const removedCalls = staticKeyCalls(`<UButton :label="t('sales.events.openPos')" to="/order">`)
  const removedLinks = extractRouteLinks(`<UButton :label="t('sales.events.openPos')" to="/order">`)
  assert.ok(removedCalls.has('sales.events.openPos'))
  assert.ok(removedLinks.has('/order'))

  const keys = orphanedKeyCandidates({
    definedKeys: ['sales.events.openPos', 'sales.events.close'],
    removedCalls,
    remainingCalls: new Set(['sales.events.close']), // nothing surviving calls openPos
    dynamicPrefixes: new Set(),
  })
  assert.deepEqual(keys, ['sales.events.openPos'])

  const pages = strandedPageCandidates({
    pageRoutes: ['/order', '/'],
    removedLinks,
    remainingRefs: new Set(['/']), // nothing surviving links to /order
  })
  assert.deepEqual(pages, ['/order'])
})

// ── The dynamic-key false-positive counterpart (#1957) ───────────────────────────────────────
test('#1957 guard — a key reached only via a dynamic prefix is NOT flagged', () => {
  const keys = orphanedKeyCandidates({
    definedKeys: ['sales.events.openPos'],
    removedCalls: new Set(['sales.events.openPos']),
    remainingCalls: new Set(), // no surviving STATIC caller...
    dynamicPrefixes: new Set(['sales.events.']), // ...but a surviving DYNAMIC one covers it
  })
  assert.deepEqual(keys, [])
})

test('a surviving static caller keeps the key off the candidate list', () => {
  const keys = orphanedKeyCandidates({
    definedKeys: ['sales.events.openPos'],
    removedCalls: new Set(['sales.events.openPos']),
    remainingCalls: new Set(['sales.events.openPos']),
    dynamicPrefixes: new Set(),
  })
  assert.deepEqual(keys, [])
})

test('a removed call to an UNdefined key is not a candidate (only defined keys can be orphaned)', () => {
  const keys = orphanedKeyCandidates({
    definedKeys: ['a.b'],
    removedCalls: new Set(['not.defined']),
    remainingCalls: new Set(),
    dynamicPrefixes: new Set(),
  })
  assert.deepEqual(keys, [])
})

test('isAllDynamicRoute skips fully-dynamic routes only', () => {
  assert.equal(isAllDynamicRoute('/:id'), true)
  assert.equal(isAllDynamicRoute('/[id]'), true)
  assert.equal(isAllDynamicRoute('/order'), false)
  assert.equal(isAllDynamicRoute('/order/:id'), false) // has a static segment
  assert.equal(isAllDynamicRoute('/'), false)
})

test('routeIsReferenced matches the route or any child path', () => {
  assert.equal(routeIsReferenced('/order', new Set(['/order'])), true)
  assert.equal(routeIsReferenced('/order', new Set(['/order/new'])), true) // child keeps parent alive
  assert.equal(routeIsReferenced('/order', new Set(['/orders'])), false) // sibling prefix, not a child
  assert.equal(routeIsReferenced('/order', new Set(['/'])), false)
})

test('strandedPageCandidates skips all-dynamic routes and still-referenced pages', () => {
  const pages = strandedPageCandidates({
    pageRoutes: ['/order', '/:id', '/keep'],
    removedLinks: ['/order', '/:id', '/keep'],
    remainingRefs: new Set(['/keep']), // /keep still linked, /:id all-dynamic → both skipped
  })
  assert.deepEqual(pages, ['/order'])
})

test('removedLines returns deleted content, excluding the --- file header', () => {
  const diff = ['--- a/x.vue', '+++ b/x.vue', "-  t('a.b')", '+  t("c.d")', ' unchanged'].join('\n')
  assert.deepEqual(removedLines(diff), ["  t('a.b')"])
})

test('routeForPageFile maps page files to routes', () => {
  assert.equal(routeForPageFile('app/pages/order/index.vue'), '/order')
  assert.equal(routeForPageFile('app/pages/index.vue'), '/')
  assert.equal(routeForPageFile('app/pages/order/new.vue'), '/order/new')
  assert.equal(routeForPageFile('apps/velo/app/pages/order/[id].vue'), '/order/:id')
  assert.equal(routeForPageFile('components/Foo.vue'), null)
})

test('extractRouteLinks pulls quoted absolute paths and normalises trailing slashes', () => {
  const text = `to="/order" navigateTo('/order/') href="/order/new" class="p-4"`
  assert.deepEqual([...extractRouteLinks(text)].sort(), ['/order', '/order/new'])
})

test('parseArgs defaults to diff mode against origin/main', () => {
  assert.deepEqual(parseArgs([]), { base: 'origin/main', corpus: false, json: false })
  assert.deepEqual(parseArgs(['--base', 'HEAD~1']), { base: 'HEAD~1', corpus: false, json: false })
  assert.deepEqual(parseArgs(['--corpus', '--json']), { base: 'origin/main', corpus: true, json: true })
})
