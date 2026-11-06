import { test } from 'node:test'
import assert from 'node:assert/strict'
import { epicBranchName, isV1Base, v1Enabled } from './pipeline-version.mjs'
import { parseEpicNumber } from '../epic-ready.mjs'
import { slugify } from '../epic-scaffold.mjs'

const titles = ['v1 step 1', '--v1 -- step 1--', 'a  --  b', 'Ünïcode — dash']
// JS equivalent of the sed pipeline at .github/workflows/decompose-on-issue-pidev.yml:427
const decomposerSlug = (t) => t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+/, '').replace(/-+$/, '').slice(0, 40).replace(/-+$/, '')

test('epicBranchName', () => {
  assert.equal(epicBranchName({ epic: 12, slug: 'foo', version: 'v1' }), 'epic/12--v1-foo')
  assert.equal(epicBranchName({ epic: 12, slug: 'foo' }), 'epic/12-foo')
  assert.equal(epicBranchName({ epic: 12, slug: 'foo', version: 'today' }), 'epic/12-foo')
})
test('isV1Base', () => {
  assert.equal(isV1Base('epic/12--v1-x'), true)
  for (const r of ['epic/12-v1-step-1', 'epic/12-x', 'main', 'work-1', '', undefined]) assert.equal(isV1Base(r), false)
})
test('parseEpicNumber reads v1 names', () => {
  assert.equal(parseEpicNumber('epic/12--v1-x'), 12)
  assert.equal(parseEpicNumber(epicBranchName({ epic: 12, slug: 'x', version: 'v1' })), 12)
})
test('slug makers never produce -- or a v1 base', () => {
  for (const t of titles) for (const slug of [slugify(t), decomposerSlug(t)]) {
    assert.ok(!slug.includes('--'), slug)
    assert.ok(!slug.startsWith('-'), slug)
    assert.equal(isV1Base(`epic/1-${slug}`), false)
  }
})
test('v1Enabled', () => {
  for (const v of [{}, { PIPELINE_V1: 'on' }, undefined]) assert.equal(v1Enabled(v), true)
  for (const v of [{ PIPELINE_V1: 'off' }, { PIPELINE_V1: ' OFF ' }]) assert.equal(v1Enabled(v), false)
})
