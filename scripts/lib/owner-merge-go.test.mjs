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

test('a claude[bot] CI-fix commit with the marker keeps the ok; unmarked or other committers void it', () => {
  const comments = [c('pmcp', 'ok', '2026-10-27T10:00:00Z')]
  const fix = (msg, login) => ({ ...k('2026-10-27T11:00:00Z'), committer: { login }, commit: { message: msg, committer: { name: login, date: '2026-10-27T11:00:00Z' } } })
  const body = 'fix(root): fold record-decision (#3054)\n\nCI-Fix: true\n'
  assert.equal(ownerMergeGo({ owner, comments, commits: [fix(body, 'claude[bot]')] }).go, true)
  assert.equal(ownerMergeGo({ owner, comments, commits: [fix('fix(root): x', 'claude[bot]')] }).go, false)
  assert.equal(ownerMergeGo({ owner, comments, commits: [fix(body, 'nuxt-harness[bot]')] }).go, false)
})

test('real CI-fix commit e2b04d2b8 (made by the fix-bot, unmarked) still voids the ok; the same commit made by commit-ci-fix.sh keeps it', async () => {
  // Message of e2b04d2b8 inlined: CI clones are shallow, so the sha is not fetchable.
  const cn = 'claude[bot]'
  const msg = 'fix(root): fold record-decision into on-comment.yml so the single-listener guard passes (#3054)\n\n👤 For humans\nCI was failing because the new "copy owner decisions into the ticket" step was its own\ncomment-listening workflow, and the repo allows only one.\n\n🤖 For agents\n- Moved the `record-decision` job into on-comment.yml as an unrouted job (#2893)\n'
  const rest = msg.split('\n')
  const date = '2026-10-27T11:00:00Z'
  const real = { ...k(date), committer: { login: cn }, commit: { message: rest.join('\n'), committer: { name: cn, date } } }
  const comments = [c('pmcp', 'ok', '2026-10-27T10:00:00Z')]
  assert.equal(ownerMergeGo({ owner, comments, commits: [real] }).go, false) // no marker -> not trusted
  const stamped = { ...real, commit: { ...real.commit, message: `${real.commit.message.trim()}\n\nCI-Fix: true\n` } }
  assert.equal(ownerMergeGo({ owner, comments, commits: [stamped] }).go, true)
})

test('ok -> CI fix -> worker revision -> waits for a fresh ok', () => {
  const fix = { ...k('2026-10-27T11:00:00Z'), committer: { login: 'claude[bot]' }, commit: { message: 'fix: x\n\nCI-Fix: true\n', committer: { name: 'claude[bot]', date: '2026-10-27T11:00:00Z' } } }
  const revision = k('2026-10-27T12:00:00Z')
  const ok1 = c('pmcp', 'ok', '2026-10-27T10:00:00Z')
  assert.equal(ownerMergeGo({ owner, comments: [ok1], commits: [fix] }).go, true)
  assert.equal(ownerMergeGo({ owner, comments: [ok1], commits: [fix, revision] }).go, false)
  assert.equal(ownerMergeGo({ owner, comments: [ok1, c('pmcp', 'ok', '2026-10-27T13:00:00Z')], commits: [fix, revision] }).go, true)
})
