import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveBase } from './resolve-base.mjs'

test('leaf PR into an epic keeps the epic base (#2840 shape)', () => {
  const r = resolveBase({ prBase: 'epic/2804-x', headRef: 'work-2840', issueEpic: 'epic/2804-x' })
  assert.equal(r.base, 'epic/2804-x'); assert.equal(r.error, '')
})
test('PR base wins over a missing issue block', () => {
  assert.equal(resolveBase({ prBase: 'epic/2804-x', headRef: 'work-2840' }).base, 'epic/2804-x')
})
test('leaf PR into main, no epic', () => {
  assert.equal(resolveBase({ prBase: 'main', headRef: 'work-1' }).base, 'main')
})
test('epic head → main is not a mismatch', () => {
  const r = resolveBase({ prBase: 'main', headRef: 'epic/2858-y', issueEpic: 'epic/2858-y' })
  assert.equal(r.base, 'main'); assert.equal(r.error, '')
})
test('no open PR: issue epic, else main', () => {
  assert.equal(resolveBase({ issueEpic: 'epic/9-z' }).base, 'epic/9-z')
  assert.equal(resolveBase({}).base, 'main')
})
test('mismatch names both branches', () => {
  const r = resolveBase({ prBase: 'epic/A', headRef: 'work-5', issueEpic: 'epic/B' })
  assert.match(r.error, /epic\/A/); assert.match(r.error, /epic\/B/)
})
