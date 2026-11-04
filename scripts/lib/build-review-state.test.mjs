import { test } from 'node:test'
import assert from 'node:assert/strict'
import { reviewState } from './build-review-state.mjs'
import { chooseOkReply } from './ok-reply.mjs'
import { decideLeafMerge } from './pr-merge-gate.mjs'

const bots = ['app[bot]']
const bot = (body, at) => ({ user: { login: 'app[bot]', type: 'Bot' }, body, created_at: at })
const human = (body, at) => ({ user: { login: 'pmcp', type: 'User' }, body, created_at: at })
const st = (comments, headSha = 'bbb') => reviewState({ comments, headSha, bots })
const verdict = (sha, v, extra = '', head = '🔴 **Build sent back**') =>
  `<!-- build-review-sha:${sha} -->\n<!-- build-review:v1 -->\n${extra}<!-- build-review-verdict:${v} -->\n> 🤖 pipeline\n\n${head}\n`

test('newest state is for an older SHA → pending', () => assert.equal(st([bot(verdict('aaa', 'no-go'), '2026-11-01T10:00:00Z')]).kind, 'pending'))
test('failed-sha equal to head → failed; older → pending', () => {
  const f = (sha) => bot(`<!-- build-review-failed-sha:${sha} -->\nfailed`, '2026-11-01T10:00:00Z')
  assert.equal(st([f('bbb')]).kind, 'failed')
  assert.equal(st([f('aaa')]).kind, 'pending')
})
test('round-1 comment quoting "Build rejected twice" in its evidence → round1', () => {
  const b = verdict('bbb', 'no-go') + '\n- evidence: the earlier "🔴 **Build rejected twice**" text\n'
  assert.equal(st([bot(b, '2026-11-01T10:00:00Z')]).kind, 'round1')
})
test('non-bot comment with the final marker or needs-owner verdict is ignored', () => {
  assert.equal(st([human(verdict('bbb', 'no-go', '<!-- build-review-final -->\n'), '2026-11-01T10:00:00Z')]).kind, 'pending')
  assert.equal(st([human(verdict('bbb', 'needs-owner'), '2026-11-01T10:00:00Z')]).kind, 'pending')
})
test('final marker and legacy first-heading hold → final', () => {
  assert.equal(st([bot(verdict('bbb', 'no-go', '<!-- build-review-final -->\n'), '2026-11-01T10:00:00Z')]).kind, 'final')
  const legacy = verdict('bbb', 'no-go', '', '🔴 **Build rejected twice** — 1 problem(s) remain. Held for you.')
  assert.equal(st([bot(legacy, '2026-11-01T10:00:00Z')]).kind, 'final')
})
test('needs-owner / go → other; newest comment for the SHA wins', () => {
  assert.equal(st([bot(verdict('bbb', 'needs-owner'), '2026-11-01T10:00:00Z')]).kind, 'other')
  const cs = [bot(verdict('bbb', 'no-go'), '2026-11-01T10:00:00Z'), bot(verdict('bbb', 'go'), '2026-11-01T11:00:00Z')]
  assert.equal(st(cs).kind, 'other')
})
test('needs-owner verdict + owner ok → no approval (no merge) and no reply', () => {
  const state = st([bot(verdict('bbb', 'needs-owner'), '2026-11-01T10:00:00Z')])
  assert.equal(state.kind, 'other')
  const d = decideLeafMerge({ baseRef: 'epic/1-x', headRef: 'work-2', labels: [], go: { go: true, at: '2026-11-01T11:00:00Z' }, finalHold: null, red: false, ciGate: 'success', mergeableState: 'clean' })
  assert.equal(d.merge, false)
  assert.equal(chooseOkReply({ state, ownerOk: true }), null)
})
