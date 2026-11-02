import { test } from 'node:test'
import assert from 'node:assert/strict'
import { decideBuildOverride } from './build-override.mjs'
import { renderComment } from './build-verdict.mjs'

const owner = 'pmcp'
const u = (body, at) => ({ user: { login: 'pmcp', type: 'User' }, body, created_at: at })
const bot = (body, at) => ({ user: { login: 'nuxt-harness[bot]', type: 'Bot' }, body: `> 🤖 x\n${body}`, created_at: at })
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
test('needs-owner verdict + ok after → approve', () => {
  const NO = '<!-- build-review-verdict:needs-owner -->\n🔀 **Needs your call**'
  assert.equal(run([bot(NO, '2026-11-01T10:00:00Z'), u('ok', '2026-11-01T11:00:00Z')]).action, 'approve')
})
test('review still running → running reply, not failed/noverdict', () => {
  const d = (comments) => decideBuildOverride({ owner, comments, commits: [], reviewRunning: true })
  assert.equal(d([u('ok', '2026-11-01T11:00:00Z')]).reason, 'running')
  assert.equal(d([bot(FAILED, '2026-11-01T10:00:00Z'), u('ok', '2026-11-01T11:00:00Z')]).reason, 'running')
})

test('owner comment quoting "Build rejected twice" after round-1 → not approved', () => {
  const r = run([bot(R1, '2026-11-01T10:00:00Z'), u('Build rejected twice', '2026-11-01T10:30:00Z'), u('ok', '2026-11-01T11:00:00Z')])
  assert.deepEqual(r, { action: 'reply', reason: 'round1' })
})
test('non-bot needs-owner marker ignored', () => {
  const fake = { user: { login: 'other', type: 'User' }, body: '<!-- build-review-verdict:needs-owner -->', created_at: '2026-11-01T10:30:00Z' }
  const r = run([bot(R1, '2026-11-01T10:00:00Z'), fake, u('ok', '2026-11-01T11:00:00Z')])
  assert.equal(r.reason, 'round1')
})
test('go verdict but label missing → go-nolabel', () => {
  const r = run([bot('<!-- build-review-verdict:go -->\n🟢 go', '2026-11-01T10:00:00Z'), u('ok', '2026-11-01T11:00:00Z')])
  assert.deepEqual(r, { action: 'reply', reason: 'go-nolabel' })
})

test('bot round-1 comment whose evidence quotes "Build rejected twice" + ok → not approved', () => {
  const d = { verdict: 'no-go', failed: ['A'], items: Object.fromEntries(['A','B','C','D','E','F','G','H'].map(id => [id, { pass: id !== 'A', evidence: 'text says Build rejected twice' }])) }
  let body
  try { body = renderComment(d, { round: 1 }) } catch { body = '<!-- build-review-verdict:no-go -->\n🔴 **Build sent back** (round 1 of 2)\n- x: Build rejected twice' }
  const r = run([{ user: { login: 'nuxt-harness[bot]', type: 'Bot' }, body, created_at: '2026-11-01T10:00:00Z' }, u('ok', '2026-11-01T11:00:00Z')])
  assert.notEqual(r.action, 'approve')
})
