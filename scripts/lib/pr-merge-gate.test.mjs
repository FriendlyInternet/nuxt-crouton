import { test } from 'node:test'
import assert from 'node:assert/strict'
import { decideLeafMerge } from './pr-merge-gate.mjs'
import { ownerMergeGo } from './owner-merge-go.mjs'

const base = { baseRef: 'main', headRef: 'work-1', labels: [], go: { go: true }, red: false, ciGate: 'success', mergeableState: 'clean' }
const d = (o) => decideLeafMerge({ ...base, ...o })

test('no owner go → never merges, even with build:approved', () => {
  assert.equal(d({ go: { go: false } }).merge, false)
  assert.equal(d({ go: { go: false }, labels: ['build:approved'] }).merge, false)
})
test('owner go + green, no label → merges', () => assert.equal(d({}).merge, true))
test('red → no merge', () => assert.equal(d({ red: true }).merge, false))
test('CI Gate not success → no merge', () => assert.equal(d({ ciGate: 'pending' }).merge, false))
test('blocked/dirty → no merge, reason names it', () => {
  for (const s of ['blocked', 'dirty']) {
    const r = d({ mergeableState: s })
    assert.equal(r.merge, false)
    assert.match(r.reason, new RegExp(s))
  }
})
test('epic-based PR without build:approved → no merge even with go', () => {
  assert.equal(d({ baseRef: 'epic/1-x', headRef: 'work-1' }).merge, false)
  assert.equal(d({ baseRef: 'epic/1-x', headRef: 'work-1', labels: ['build:approved'] }).merge, true)
})
test('non-work head to main → declined', () => assert.equal(d({ headRef: 'feature/x' }).merge, false))

// Ordering lives in ownerMergeGo; feed it real fixtures.
const owner = 'pmcp'
const c = (body, at) => ({ user: { login: owner, type: 'User' }, body, created_at: at })
const k = (date) => ({ parents: [{}], commit: { committer: { date } }, files: ['a.ts'] })
test('ok then green, and green then ok, both give go', () => {
  assert.equal(ownerMergeGo({ owner, comments: [c('ok', '2026-10-28T16:00:00Z')], commits: [k('2026-10-28T15:00:00Z')] }).go, true)
})
test('ok then a later worker comment → no go', () => {
  const comments = [c('ok', '2026-10-28T16:00:00Z'), c('**Worker:** pushed a fix', '2026-10-28T16:05:00Z')]
  assert.equal(ownerMergeGo({ owner, comments, commits: [] }).go, false)
})
test('ok then a later non-merge commit → no go', () => {
  assert.equal(ownerMergeGo({ owner, comments: [c('ok', '2026-10-28T16:00:00Z')], commits: [k('2026-10-28T17:00:00Z')] }).go, false)
})
