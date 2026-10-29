import { test } from 'node:test'
import assert from 'node:assert/strict'
import { decideLeafMerge } from './pr-merge-gate.mjs'
import { ownerMergeGo } from './owner-merge-go.mjs'

const owner = 'pmcp'
const c = (body, at) => ({ user: { login: owner, type: 'User' }, body, created_at: at })
const k = (date) => ({ parents: [{}], commit: { committer: { date } }, files: ['a.ts'] })
const goFor = (comments, commits = []) => ownerMergeGo({ owner, comments, commits })
const okGo = { go: true }
// A work-* → main PR with everything green; override one fact per case.
const leaf = (o = {}) => decideLeafMerge({
  baseRef: 'main', headRef: 'work-1', labels: [], go: okGo, red: false, ciGate: 'success', mergeableState: 'clean', ...o,
})

test('1. no owner ok + everything green → no merge, even with build:approved (the key safety case)', () => {
  assert.equal(leaf({ go: { go: false } }).merge, false)
  assert.equal(leaf({ go: { go: false }, labels: ['build:approved'] }).merge, false)
})
test('2. owner ok, CI Gate success, not red, clean, no label → merge', () => {
  assert.equal(leaf().merge, true)
})
test('3. owner ok but a check is red → no merge', () => {
  const r = leaf({ red: true })
  assert.equal(r.merge, false)
  assert.equal(r.code, 'red')
})
test('4. owner ok but CI Gate not success → no merge', () => {
  for (const ciGate of ['pending', 'missing', 'failure']) assert.equal(leaf({ ciGate }).merge, false)
})
test('5. owner ok but blocked/dirty → no merge, reason names it', () => {
  for (const mergeableState of ['blocked', 'dirty']) {
    const r = leaf({ mergeableState })
    assert.equal(r.merge, false)
    assert.match(r.reason, new RegExp(mergeableState))
  }
})
test('6. epic-based PR needs build:approved, even with go', () => {
  const e = (labels) => decideLeafMerge({ baseRef: 'epic/1-x', headRef: 'work-1', labels, go: okGo, red: false, ciGate: 'success', mergeableState: 'clean' })
  assert.equal(e([]).merge, false)
  assert.equal(e(['build:approved']).merge, true)
})
test('7. non-work-* head into main is declined; epic → main needs build:approved AND ok', () => {
  assert.equal(leaf({ headRef: 'feature/x' }).merge, false)
  const e = (labels, go) => decideLeafMerge({ baseRef: 'main', headRef: 'epic/1-x', labels, go: { go }, ciGate: 'success', mergeableState: 'clean' }).merge
  assert.equal(e([], true), false)
  assert.equal(e(['build:approved'], false), false)
  assert.equal(e(['build:approved'], true), true)
})

// Ordering lives in ownerMergeGo, fed real comment/commit fixtures.
test('ok then green and green then ok give the same go → merge', () => {
  const go = goFor([c('ok', '2026-10-28T16:00:00Z')], [k('2026-10-28T15:00:00Z')])
  assert.equal(go.go, true)
  assert.equal(leaf({ go }).merge, true)
})
test('ok then a later worker comment → no merge', () => {
  assert.equal(leaf({ go: goFor([c('ok', '2026-10-28T16:00:00Z'), c('**Worker:** pushed a fix', '2026-10-28T16:05:00Z')]) }).merge, false)
})
test('ok then a later non-merge commit → no merge', () => {
  assert.equal(leaf({ go: goFor([c('ok', '2026-10-28T16:00:00Z')], [k('2026-10-28T17:00:00Z')]) }).merge, false)
})
test('ok, then an owner **Worker:** comment, then the worker commit → no merge until a fresh ok', () => {
  const comments = [c('ok', '2026-10-28T16:00:00Z'), c('**Worker:** adding a case', '2026-10-28T16:05:00Z')]
  const commits = [k('2026-10-28T16:10:00Z')]
  assert.equal(leaf({ go: goFor(comments, commits) }).merge, false)
  const fresh = [...comments, c('ok', '2026-10-28T16:20:00Z')]
  assert.equal(leaf({ go: goFor(fresh, commits) }).merge, true)
})
