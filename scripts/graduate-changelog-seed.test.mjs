/**
 * Issue #2036 contract — a POC changelog seeds an app's changelog origin
 * (validating copy, same `{v, note, commit}` shape), and "is this a POC
 * changelog" is resolved via the declared stage model, not a hardcoded
 * `poc`/`spike` path fragment.
 *
 *   node --test scripts/graduate-changelog-seed.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadStages } from './harness-stages.mjs'
import { isIncubatorPath, seedAppChangelogFromPoc } from './graduate-changelog-seed.mjs'

const model = await loadStages()

test('isIncubatorPath: true for a pocs/ path (preview-deploy stage)', () => {
  assert.equal(isIncubatorPath('pocs/crouton-builder-demo/app/spike-changelog.json', model), true)
})

test('isIncubatorPath: false for an apps/ or packages/ path', () => {
  assert.equal(isIncubatorPath('apps/velo/app/changelog.json', model), false)
  assert.equal(isIncubatorPath('packages/crouton-feedback/x.ts', model), false)
})

test('isIncubatorPath: survives a poc → spike stage rename (checks deploy target, not the key)', () => {
  const { poc, ...rest } = model.stages
  const renamed = { stages: { spike: poc, ...rest }, unstaged: model.unstaged }
  assert.equal(isIncubatorPath('pocs/x/app/spike-changelog.json', renamed), true)
})

test('seedAppChangelogFromPoc: copies well-formed entries, newest first, backfills commit', () => {
  const raw = [
    { v: 1, note: 'first', commit: 'abc' },
    { v: 3, note: 'third' },
    { v: 2, note: 'second', commit: 'def' }
  ]
  assert.deepEqual(seedAppChangelogFromPoc(raw), [
    { v: 3, note: 'third', commit: '' },
    { v: 2, note: 'second', commit: 'def' },
    { v: 1, note: 'first', commit: 'abc' }
  ])
})

test('seedAppChangelogFromPoc: drops malformed entries (missing numeric v)', () => {
  const raw = [{ v: 1, note: 'ok' }, { note: 'no version' }, null, 'garbage', { v: 'x', note: 'bad' }]
  assert.deepEqual(seedAppChangelogFromPoc(raw), [{ v: 1, note: 'ok', commit: '' }])
})

test('seedAppChangelogFromPoc: non-array input yields []', () => {
  assert.deepEqual(seedAppChangelogFromPoc(null), [])
  assert.deepEqual(seedAppChangelogFromPoc(undefined), [])
  assert.deepEqual(seedAppChangelogFromPoc({}), [])
})

test('seedAppChangelogFromPoc: real crouton-builder-demo spike-changelog.json seeds cleanly', async () => {
  const { readFileSync } = await import('node:fs')
  const { resolve, dirname } = await import('node:path')
  const { fileURLToPath } = await import('node:url')
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  const raw = JSON.parse(readFileSync(resolve(root, 'pocs/crouton-builder-demo/app/spike-changelog.json'), 'utf8'))
  const seeded = seedAppChangelogFromPoc(raw)
  assert.equal(seeded.length, raw.length)
  assert.equal(seeded[0].v, 52)
  assert.ok(seeded.every((e, i) => i === 0 || e.v < seeded[i - 1].v))
})
