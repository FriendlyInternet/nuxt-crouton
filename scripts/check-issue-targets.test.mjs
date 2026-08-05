/**
 * #1689 contract — the reachability probe for `issue-sanity-check`.
 *
 * The case that minted it: #1657 named `ProductsTab.vue`, a component mounted in no template.
 * Building exactly to spec would have shipped an unclickable button while satisfying every
 * acceptance criterion.
 *
 *   node --test scripts/check-issue-targets.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { extractPaths, classifyTarget, assessTarget, formatReport, referenceQuery, REGISTRY_GLOBS } from './check-issue-targets.mjs'

const TAB = 'packages/crouton-sales/app/components/EventWorkspace/ProductsTab.vue'
const ENDPOINT = 'packages/crouton-sales/server/api/crouton-sales/teams/[id]/events/[eventId]/products/import.post.ts'
const BLOCK = 'packages/crouton-sales/app/components/Blocks/OrdersRender.vue'

test('extractPaths pulls repo paths out of an issue body and ignores prose', () => {
  const body = [
    'Add the button to `' + TAB + '` and also edit',
    'packages/crouton-sales/app/components/Client/OrderInterface.vue.',
    'See https://example.com/not/a/path.html and the "products/import" endpoint.',
  ].join('\n')
  const paths = extractPaths(body)
  assert.ok(paths.includes(TAB))
  assert.ok(paths.includes('packages/crouton-sales/app/components/Client/OrderInterface.vue'))
  assert.equal(paths.length, 2)
})

test('extractPaths dedupes a path named several times', () => {
  assert.deepEqual(extractPaths(`${TAB} and again ${TAB}`), [TAB])
})

test('extractPaths returns nothing for a body with no paths', () => {
  assert.deepEqual(extractPaths('Make the import faster, please.'), [])
  assert.deepEqual(extractPaths(''), [])
  assert.deepEqual(extractPaths(undefined), [])
})

test('file-routed targets are reachable by convention — never probed', () => {
  for (const p of [
    ENDPOINT,
    'apps/fanfare/app/pages/admin/[team]/sales.vue',
    'packages/crouton-sales/server/utils/plan-product-import.ts',
    'packages/crouton-sales/app/composables/usePosOrder.ts',
    'packages/crouton-sales/app/app.config.ts',
  ]) {
    assert.equal(classifyTarget(p).kind, 'convention', p)
    assert.equal(assessTarget({ path: p, references: [] }).status, 'convention', p)
  }
})

test('a component with no references anywhere is flagged unreachable (the #1657 case)', () => {
  const a = assessTarget({ path: TAB, references: [] })
  assert.equal(a.status, 'unreachable')
  assert.match(a.evidence, /no references/)
})

test('a component mentioned ONLY in prose is still unreachable — docs are not a mount', () => {
  const a = assessTarget({
    path: TAB,
    references: [{ file: 'packages/crouton-sales/CLAUDE.md' }, { file: TAB }],
  })
  assert.equal(a.status, 'unreachable')
  assert.match(a.evidence, /only mentioned in prose/)
})

test('a component referenced from real code is reachable', () => {
  const a = assessTarget({
    path: TAB,
    references: [{ file: 'packages/crouton-sales/app/components/EventWorkspace/Shell.vue' }],
  })
  assert.equal(a.status, 'reachable')
})

test('a registry-mounted block is reachable, not a false positive', () => {
  const a = assessTarget({
    path: BLOCK,
    references: [{ file: 'packages/crouton-sales/app/app.config.ts' }],
  })
  assert.equal(a.status, 'registry')
  assert.match(a.evidence, /registered in/)
})

test('a self-reference does not count as being reachable', () => {
  assert.equal(assessTarget({ path: TAB, references: [{ file: TAB }] }).status, 'unreachable')
})

test('formatReport frames an unreachable target as reshape, with the dynamic-mount caveat', () => {
  const out = formatReport([assessTarget({ path: TAB, references: [] })])
  assert.match(out, /🔁/)
  assert.match(out, /Confirm where it should live before building/)
  assert.match(out, /hypothesis, not proof/)
  assert.doesNotMatch(out, /🛑/) // never a drop
})

test('formatReport passes cleanly when everything is reachable', () => {
  const out = formatReport([
    assessTarget({ path: ENDPOINT, references: [] }),
    assessTarget({ path: TAB, references: [{ file: 'x/Shell.vue' }] }),
  ])
  assert.match(out, /✅ all 2 named path\(s\)/)
})

test('formatReport says n/a when the issue names no paths', () => {
  assert.match(formatReport([]), /n\/a/)
})

// ── referenceQuery: the two false positives found by running this against the real repo ──

test('component query matches a MULTI-LINE tag (nothing after the name on its line)', () => {
  const q = new RegExp(referenceQuery('component', 'ProductImportPreview').replace(/\[\[:space:\]/g, '[\\s'))
  // The real mount in ProductImportModal.vue — attributes are on the following lines.
  assert.ok(q.test('            <SalesEventWorkspaceProductImportPreview'))
  assert.ok(q.test('  <SalesEventWorkspaceProductImportPreview :rows="rows"'))
  assert.ok(q.test('  <ProductImportPreview/>'))
})

test('component query matches the kebab tag form too', () => {
  const q = new RegExp(referenceQuery('component', 'ProductsTab').replace(/\[\[:space:\]/g, '[\\s'))
  assert.ok(q.test('  <sales-event-workspace-products-tab :event="e" />'))
})

test('component query does NOT match a bare mention in a code comment', () => {
  const q = new RegExp(referenceQuery('component', 'ProductsTab').replace(/\[\[:space:\]/g, '[\\s'))
  // Both of these exist verbatim in the repo and made the first version report the
  // deadest component in the package as reachable.
  assert.equal(q.test('// ProductsTab). Always the render source so editable paths match.'), false)
  assert.equal(q.test('`ProductsTab.vue` renders products as a drag-reorderable list'), false)
})

test('module query requires an import, not a mention', () => {
  const q = new RegExp(referenceQuery('module', 'plan-product-import'))
  assert.ok(q.test("import { planProductImport } from '../utils/plan-product-import'"))
  assert.equal(q.test('// see plan-product-import for the pure planning'), false)
})

test('registry globs are scoped to config/manifest files only', () => {
  assert.deepEqual(REGISTRY_GLOBS, ['*app.config.ts', '*.manifest.ts'])
})
