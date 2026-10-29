import { test } from 'node:test'
import assert from 'node:assert/strict'
import { decideReviewGate } from './pr-merge-gate.mjs'
import { ownerMergeGo } from './owner-merge-go.mjs'

const owner = 'pmcp'
const c = (body, at) => ({ user: { login: owner, type: 'User' }, body, created_at: at })
const k = (date) => ({ parents: [{}], commit: { committer: { date } }, files: ['a.ts'] })
const goFor = (comments, commits = []) => ownerMergeGo({ owner, comments, commits })
const leaf = (go, labels = []) => decideReviewGate({ baseRef: 'main', headRef: 'work-1', labels, go })

test('leaf → main: owner ok merges without build:approved', () => {
  assert.equal(leaf(goFor([c('ok', '2026-10-28T16:00:00Z')], [k('2026-10-28T15:00:00Z')])).merge, true)
})
test('leaf → main: no ok → no merge, even with build:approved', () => {
  assert.equal(leaf(goFor([]), ['build:approved']).merge, false)
})
test('ok given while checks red, then checks go green: gate still open (order is irrelevant)', () => {
  // ok at 16:00; a green check later adds no commit/comment, so the same events give go again.
  const go = goFor([c('ok', '2026-10-28T16:00:00Z')], [k('2026-10-28T15:00:00Z')])
  assert.equal(go.go, true)
  assert.equal(leaf(go).merge, true)
})
test('ok then a later worker comment → no merge', () => {
  assert.equal(leaf(goFor([c('ok', '2026-10-28T16:00:00Z'), c('**Worker:** pushed a fix', '2026-10-28T16:05:00Z')])).merge, false)
})
test('ok then a later non-merge commit → no merge', () => {
  assert.equal(leaf(goFor([c('ok', '2026-10-28T16:00:00Z')], [k('2026-10-28T17:00:00Z')])).merge, false)
})
test('epic-based PR needs build:approved', () => {
  const go = { go: false }
  assert.equal(decideReviewGate({ baseRef: 'epic/1-x', headRef: 'work-1', labels: [], go }).merge, false)
  assert.equal(decideReviewGate({ baseRef: 'epic/1-x', headRef: 'work-1', labels: ['build:approved'], go }).merge, true)
})
test('epic → main needs build:approved AND owner ok', () => {
  const e = (labels, go) => decideReviewGate({ baseRef: 'main', headRef: 'epic/1-x', labels, go: { go } }).merge
  assert.equal(e([], true), false)
  assert.equal(e(['build:approved'], false), false)
  assert.equal(e(['build:approved'], true), true)
})
