import { test } from 'node:test'
import assert from 'node:assert/strict'
import { decideBuildOverride } from './build-override.mjs'

const owner = 'pmcp'
const u = (body, at) => ({ user: { login: 'pmcp', type: 'User' }, body, created_at: at })
const bot = (body, at) => ({ user: { login: 'bot', type: 'Bot' }, body: `> 🤖 x\n${body}`, created_at: at })
const k = (date, parents = 1) => ({ parents: Array(parents).fill({}), commit: { committer: { date } } })
const FINAL = '<!-- build-review-verdict:no-go -->\n<!-- build-review-final -->\n🔴 **Build rejected twice**'
const LEGACY = '<!-- build-review-verdict:no-go -->\n🔴 **Build rejected twice**'
const R1 = '<!-- build-review-verdict:no-go -->\n🔴 **Build sent back** (round 1 of 2)'
const FAILED = '<!-- build-review-failed -->\nreview failed'

const run = (comments, commits = []) => decideBuildOverride({ owner, comments, commits })

test('final no-go + ok after → approve', () => {
  assert.equal(run([bot(FINAL, '2026-11-01T10:00:00Z'), u('ok', '2026-11-01T11:00:00Z')], [k('2026-11-01T09:00:00Z')]).action, 'approve')
})
test('ok before final → stale-ok', () => {
  const r = run([u('ok', '2026-11-01T09:00:00Z'), bot(FINAL, '2026-11-01T10:00:00Z')])
  assert.deepEqual(r, { action: 'reply', reason: 'stale-ok' })
})
test('ok then non-merge commit → revised', () => {
  const r = run([bot(FINAL, '2026-11-01T10:00:00Z'), u('ok', '2026-11-01T11:00:00Z')], [k('2026-11-01T12:00:00Z')])
  assert.deepEqual(r, { action: 'reply', reason: 'revised' })
})
test('round-1 no-go + ok → round1 reply', () => {
  assert.equal(run([bot(R1, '2026-11-01T10:00:00Z'), u('ok', '2026-11-01T11:00:00Z')]).reason, 'round1')
})
test('round-1 no-go, then review-failed, then ok → failed (re-run)', () => {
  const r = run([bot(R1, '2026-11-01T10:00:00Z'), bot(FAILED, '2026-11-01T10:30:00Z'), u('ok', '2026-11-01T11:00:00Z')])
  assert.equal(r.reason, 'failed')
})
test('no verdict + ok → noverdict', () => {
  assert.equal(run([u('ok', '2026-11-01T11:00:00Z')]).reason, 'noverdict')
})
test('non-owner ok ignored', () => {
  const c = { user: { login: 'other', type: 'User' }, body: 'ok', created_at: '2026-11-01T11:00:00Z' }
  assert.equal(run([bot(FINAL, '2026-11-01T10:00:00Z'), c]).action, 'none')
})
test('legacy final text without marker still approves', () => {
  assert.equal(run([bot(LEGACY, '2026-11-01T10:00:00Z'), u('ok', '2026-11-01T11:00:00Z')]).action, 'approve')
})
test('merge-only commit after ok still approves', () => {
  assert.equal(run([bot(FINAL, '2026-11-01T10:00:00Z'), u('ok', '2026-11-01T11:00:00Z')], [k('2026-11-01T12:00:00Z', 2)]).action, 'approve')
})
