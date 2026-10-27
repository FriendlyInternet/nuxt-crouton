import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ownerMergeGo } from './owner-merge-go.mjs'

const owner = 'pmcp'
const c = (login, body, at, type = 'User') => ({ user: { login, type }, body, created_at: at })
const k = (date, parents = 1) => ({ parents: Array(parents).fill({}), commit: { committer: { date } } })

test('owner ok with older commits → go', () => {
  const r = ownerMergeGo({ owner, comments: [c('pmcp', 'ok', '2026-10-27T10:00:00Z')], commits: [k('2026-10-27T09:00:00Z')] })
  assert.equal(r.go, true)
})

test('legacy lgtm still goes', () => {
  assert.equal(ownerMergeGo({ owner, comments: [c('pmcp', 'lgtm', '2026-10-27T10:00:00Z')], commits: [] }).go, true)
})

test('agent-headed comment containing ok/lgtm does not count', () => {
  const body = '> 🤖 **tool** · posted from pmcp\n\nlgtm'
  assert.equal(ownerMergeGo({ owner, comments: [c('pmcp', body, '2026-10-27T10:00:00Z')], commits: [] }).go, false)
})

test('someone else saying ok does not count', () => {
  assert.equal(ownerMergeGo({ owner, comments: [c('other', 'ok', '2026-10-27T10:00:00Z')], commits: [] }).go, false)
  assert.equal(ownerMergeGo({ owner, comments: [c('pmcp', 'ok', '2026-10-27T10:00:00Z', 'Bot')], commits: [] }).go, false)
})

test('ok, but … is a change request, not a go', () => {
  assert.equal(ownerMergeGo({ owner, comments: [c('pmcp', 'ok, but rename X', '2026-10-27T10:00:00Z')], commits: [] }).go, false)
})

test('a non-merge commit after the approval supersedes it; a merge commit does not', () => {
  const comments = [c('pmcp', 'ok', '2026-10-27T10:00:00Z')]
  assert.equal(ownerMergeGo({ owner, comments, commits: [k('2026-10-27T11:00:00Z')] }).go, false)
  assert.equal(ownerMergeGo({ owner, comments, commits: [k('2026-10-27T11:00:00Z', 2)] }).go, true)
})

test('a later not ok cancels an earlier ok', () => {
  const comments = [c('pmcp', 'ok', '2026-10-27T10:00:00Z'), c('pmcp', 'not ok: wrong', '2026-10-27T10:05:00Z')]
  assert.equal(ownerMergeGo({ owner, comments, commits: [] }).go, false)
})

test('ok followed by a non-verdict change request resets to no go', () => {
  const comments = [c('pmcp', 'ok', '2026-10-27T10:00:00Z'), c('pmcp', 'ok, but rename X', '2026-10-27T10:05:00Z')]
  assert.equal(ownerMergeGo({ owner, comments, commits: [] }).go, false)
})

test('commits touching only writeups/ui-proposals do not void an approval; mixed ones do', () => {
  const comments = [c('pmcp', 'ok', '2026-10-27T10:00:00Z')]
  const cap = { ...k('2026-10-27T11:00:00Z'), files: ['writeups/ui-proposals/2832-a.png'] }
  const mixed = { ...k('2026-10-27T11:00:00Z'), files: ['writeups/ui-proposals/2832-a.png', 'scripts/x.mjs'] }
  assert.equal(ownerMergeGo({ owner, comments, commits: [cap] }).go, true)
  assert.equal(ownerMergeGo({ owner, comments, commits: [mixed] }).go, false)
})
