// node --test scripts/lib/doc-paths.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { extractDocPaths, buildPathIndex, findStaleDocPaths } from './doc-paths.mjs'

const index = buildPathIndex([
  'packages/a/CLAUDE.md',
  'packages/a/server/utils/live.ts',
  'packages/a/app/components/Panel.vue',
  'packages/b/collections/x/app/components/Deep.vue',
  'packages/x/server/api/thing.ts',
])

test('T1 existing package-relative path → no hit; deleted → hit on the right line', () => {
  const text = 'intro\nSee `server/utils/live.ts`.\nAnd `server/utils/gone.ts` here.\n'
  assert.deepEqual(findStaleDocPaths({ pkg: 'a', text, index }), [
    { pkg: 'a', line: 3, name: 'server/utils/gone.ts' },
  ])
})

test('T2 package-relative path resolves against own package, then anywhere in repo', () => {
  assert.deepEqual(findStaleDocPaths({ pkg: 'a', text: '`app/components/Panel.vue`', index }), [])
  assert.deepEqual(findStaleDocPaths({ pkg: 'c', text: '`app/components/Deep.vue`', index }), [])
  assert.deepEqual(findStaleDocPaths({ pkg: 'c', text: '`app/components/Nowhere.vue`', index }), [
    { pkg: 'c', line: 1, name: 'app/components/Nowhere.vue' },
  ])
})

test('T3 text outside backticks and fenced code blocks are ignored', () => {
  const text = [
    'plain server/utils/gone.ts mention',
    '```ts',
    '`server/utils/gone.ts`',
    '```',
    '~~~',
    '`app/gone.vue`',
    '~~~',
  ].join('\n')
  assert.deepEqual(extractDocPaths(text), [])
  assert.deepEqual(findStaleDocPaths({ pkg: 'a', text, index }), [])
})

test('T4 component/composable names and placeholder paths are not checked', () => {
  const text = [
    '`CroutonAudioPlayer`', '`useHead`',
    '`server/api/[id].ts`', '`app/components/{Name}.vue`', '`server/**/*.ts`',
    '`app/<Layer>/x.ts`', '`app/composables/useNewFeature.ts`', '`server/emails/NewEmail.vue`',
    '`server/.../x.ts`',
  ].join('\n')
  assert.deepEqual(extractDocPaths(text), [])
})

test('T5 repo-root packages/ path: missing file → hit; existing folder → none', () => {
  const text = '`packages/x/gone.ts`\n`packages/x/server`\n`packages/x/server/`'
  assert.deepEqual(findStaleDocPaths({ pkg: 'a', text, index }), [
    { pkg: 'a', line: 1, name: 'packages/x/gone.ts' },
  ])
})

test('T6 allowlist removes exactly that hit, only in that package', () => {
  const allow = [{ package: 'a', name: 'app/changelog.json', reason: 'consumer path' }]
  const text = '`app/changelog.json`\n`server/gone.ts`'
  assert.deepEqual(findStaleDocPaths({ pkg: 'a', text, index, allow }), [
    { pkg: 'a', line: 2, name: 'server/gone.ts' },
  ])
  assert.deepEqual(findStaleDocPaths({ pkg: 'b', text, index, allow }).map(h => h.name), [
    'app/changelog.json', 'server/gone.ts',
  ])
})
