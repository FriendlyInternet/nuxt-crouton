/**
 * lean-check.mjs unit tests — pure-function coverage for the #2192 report-only orphan check.
 *
 *   node --test scripts/lean-check.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  flattenKeys,
  extractLiteralKeyRefs,
  hasDynamicKeyBuilder,
  pageFileToRoutePath,
  removedLines,
  formatReport,
} from './lean-check.mjs'

test('flattenKeys turns nested locale JSON into dot-notation keys', () => {
  const keys = flattenKeys({ sales: { events: { openPos: 'Open register' }, title: 'Sales' } })
  assert.deepEqual(keys.sort(), ['sales.events.openPos', 'sales.title'])
})

test('extractLiteralKeyRefs only captures literal-string t()/$t() calls', () => {
  const text = `
    t('sales.events.openPos')
    $t("sales.title")
    t(dynamicVar)
    t('sales.' + status)
  `
  const keys = extractLiteralKeyRefs(text)
  assert.deepEqual([...keys].sort(), ['sales.events.openPos', 'sales.title'])
})

test('hasDynamicKeyBuilder flags a non-literal first arg to t()/$t() — the #1957 guard', () => {
  assert.equal(hasDynamicKeyBuilder(`t('sales.events.openPos')`), false)
  assert.equal(hasDynamicKeyBuilder(`t('sales.' + status)`), true)
  assert.equal(hasDynamicKeyBuilder(`t(dynamicKey)`), true)
  assert.equal(hasDynamicKeyBuilder('t(`sales.${status}`)'), true)
})

test('pageFileToRoutePath converts a Nuxt page file path to a route, incl. dynamic segments', () => {
  assert.equal(pageFileToRoutePath('apps/kassa/layers/pages/app/pages/[slug]/order.vue'), '/:slug/order')
  assert.equal(pageFileToRoutePath('apps/velo/app/pages/index.vue'), '/')
  assert.equal(pageFileToRoutePath('not/a/page.vue'), null)
})

test('removedLines extracts only diff-removed lines, not context or the file-header --- line', () => {
  const diff = [
    'diff --git a/x.vue b/x.vue',
    '--- a/x.vue',
    '+++ b/x.vue',
    '@@ -1,3 +1,2 @@',
    ' <template>',
    "-  <button @click=\"openPos\">{{ t('sales.events.openPos') }}</button>",
    ' </template>',
  ].join('\n')
  const removed = removedLines(diff)
  assert.equal(removed.length, 1)
  assert.match(removed[0], /sales\.events\.openPos/)
})

test('formatReport calls out a zero-scanned run instead of reporting clean — no silent no-op', () => {
  const report = formatReport(
    { scanned: { localeFiles: 0, pageFiles: 0, sourceFiles: 0 }, orphanedKeys: [], strandedPages: [] },
    { mode: 'diff vs HEAD' },
  )
  assert.match(report, /MATCHED NOTHING/)
})

test('formatReport regression case: the #2186/#2187 leftovers would both be surfaced', () => {
  const report = formatReport(
    {
      scanned: { localeFiles: 3, pageFiles: 5, sourceFiles: 40 },
      orphanedKeys: [{ key: 'sales.events.openPos', definedIn: ['apps/kassa/layers/pages/i18n/locales/en.json'] }],
      strandedPages: [{ page: 'apps/kassa/layers/pages/app/pages/[slug]/order.vue', route: '/:slug/order' }],
    },
    { mode: 'diff vs HEAD' },
  )
  assert.match(report, /sales\.events\.openPos/)
  assert.match(report, /order\.vue/)
  assert.match(report, /never fails the build and never deletes/)
})
