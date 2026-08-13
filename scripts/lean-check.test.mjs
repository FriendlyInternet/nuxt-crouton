/**
 * lean-check.test.mjs — the #2190 "keep it lean" check exercised on its pure helpers (no I/O),
 * including the #2186 regression the issue names as the acceptance check:
 *
 *   • orphaned i18n key  — `sales.events.openPos` left after its last `t(...)` caller was deleted
 *   • stranded Nuxt page — `.../[slug]/order.vue` left after the button linking to `/order` went away
 *
 * …and their #1957 false-positive counterparts: a key still reached via a DYNAMIC prefix
 * (`t('sales.events.' + status)`) and a page whose route segment is still linked somewhere are
 * NOT reported. This is the "run the rule over the corpus, not just its imagination" bar
 * (AGENTS.md → Authoring a gate): the last block replays the shape against literal inputs that
 * mirror the real #2186 diff.
 *
 *   node --test scripts/lean-check.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  flattenKeys,
  extractTKeys,
  extractDynamicPrefixes,
  removedTKeys,
  findOrphanKeys,
  findAllOrphanKeys,
  removedLinkTargets,
  pageRoute,
  pageTerminal,
  findStrandedPages,
} from './lean-check.mjs'

test('flattenKeys flattens nested locale JSON to dot-notation leaves', () => {
  assert.deepEqual(
    flattenKeys({ sales: { events: { openPos: 'Open POS', closePos: 'Close' } }, common: { save: 'Save' } }).sort(),
    ['common.save', 'sales.events.closePos', 'sales.events.openPos'],
  )
  // arrays are leaves, not objects to recurse into
  assert.deepEqual(flattenKeys({ a: [1, 2], b: 'x' }).sort(), ['a', 'b'])
})

test('extractTKeys finds static t()/$t() keys and ignores dynamic + look-alike calls', () => {
  const text = `
    t('sales.events.openPos')
    $t("common.save")
    t(\`layout.title\`)
    t('sales.events.' + status)   // dynamic — not a static key
    emit('close'); format('x'); await wait('y')  // \\b before t stops these
  `
  const keys = extractTKeys(text)
  assert.ok(keys.includes('sales.events.openPos'))
  assert.ok(keys.includes('common.save'))
  assert.ok(keys.includes('layout.title'))
  assert.ok(!keys.includes('close'), 'emit(\'close\') must not match')
  assert.ok(!keys.includes('x') && !keys.includes('y'))
})

test('extractDynamicPrefixes captures the #1957 dynamic-key namespaces (concat + template)', () => {
  const prefixes = extractDynamicPrefixes(`t('sales.events.' + status); $t(\`bookings.status.\${s}\`)`)
  assert.ok(prefixes.includes('sales.events.'))
  assert.ok(prefixes.includes('bookings.status.'))
})

test('removedTKeys reads only deleted (-) lines, never the --- a/ header', () => {
  const diff = [
    '--- a/apps/kassa/app/components/Card.vue',
    '+++ b/apps/kassa/app/components/Card.vue',
    "-      <UButton>{{ t('sales.events.openPos') }}</UButton>",
    "+      <!-- button removed -->",
    "       {{ t('sales.events.stillHere') }}",
  ].join('\n')
  const removed = removedTKeys(diff)
  assert.deepEqual(removed, ['sales.events.openPos'])
})

test('#2186 regression — findOrphanKeys surfaces sales.events.openPos once its only caller is gone', () => {
  const orphans = findOrphanKeys({
    definedKeys: ['sales.events.openPos', 'sales.events.stillHere'],
    referencedKeys: ['sales.events.stillHere'],   // openPos no longer referenced anywhere
    dynamicPrefixes: [],
    removedKeys: ['sales.events.openPos'],
  })
  assert.deepEqual(orphans, ['sales.events.openPos'])
})

test('#1957 false-positive guard — a key still reached via a dynamic prefix is NOT orphaned', () => {
  const orphans = findOrphanKeys({
    definedKeys: ['sales.events.openPos'],
    referencedKeys: [],
    dynamicPrefixes: ['sales.events.'],           // t('sales.events.' + status) still lives
    removedKeys: ['sales.events.openPos'],
  })
  assert.deepEqual(orphans, [])
})

test('findOrphanKeys ignores a removed key that was also deleted from the locale file (already lean)', () => {
  const orphans = findOrphanKeys({
    definedKeys: [],                              // key removed from locale too → nothing to flag
    referencedKeys: [],
    dynamicPrefixes: [],
    removedKeys: ['sales.events.openPos'],
  })
  assert.deepEqual(orphans, [])
})

test('findAllOrphanKeys is the whole-repo view: every defined key with no static/dynamic reference', () => {
  const all = findAllOrphanKeys({
    definedKeys: ['a.used', 'a.dead', 'b.dynamic'],
    referencedKeys: ['a.used'],
    dynamicPrefixes: ['b.'],
  })
  assert.deepEqual(all, ['a.dead'])
})

test('removedLinkTargets pulls to=/href=/navigateTo targets off deleted lines', () => {
  const diff = [
    '--- a/apps/kassa/app/components/Card.vue',
    '-      <UButton to="/order">Kassa openen</UButton>',
    '-      <NuxtLink :to="`/order`">x</NuxtLink>',
    '-      onClick() { navigateTo(\'/order\') }',
    '+      <!-- removed -->',
  ].join('\n')
  assert.deepEqual(removedLinkTargets(diff).sort(), ['/order'])
})

test('pageRoute / pageTerminal map a Nuxt page path to its route + last static segment', () => {
  assert.equal(pageRoute('apps/kassa/app/pages/[slug]/order.vue'), '/:slug/order')
  assert.equal(pageTerminal('apps/kassa/app/pages/[slug]/order.vue'), 'order')
  assert.equal(pageRoute('apps/kassa/app/pages/index.vue'), '/')
  assert.equal(pageTerminal('apps/kassa/app/pages/[id].vue'), null, 'all-dynamic route → no terminal to match')
})

test('#2186 regression — findStrandedPages surfaces the /order page once its only link is removed', () => {
  const stranded = findStrandedPages({
    pageFiles: ['apps/kassa/app/pages/[slug]/order.vue'],
    removedTargets: ['/order'],
    referenced: new Set(),                        // `order` linked nowhere else
  })
  assert.equal(stranded.length, 1)
  assert.equal(stranded[0].terminal, 'order')
  assert.equal(stranded[0].route, '/:slug/order')
})

test('#1957 page analog — a page whose segment is still linked somewhere is NOT stranded', () => {
  const stranded = findStrandedPages({
    pageFiles: ['apps/kassa/app/pages/[slug]/order.vue'],
    removedTargets: ['/order'],
    referenced: new Set(['order']),               // another surviving NuxtLink still points at it
  })
  assert.deepEqual(stranded, [])
})
