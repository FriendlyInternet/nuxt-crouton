// The owner's reply to a test card (#2542). A wrong verdict marks an epic verified/failed wrongly.
//   node --test scripts/handle-test-reply.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { decideTestReply, buildFailureIssue, decideEpicClose } from './handle-test-reply.mjs'

const base = { labels: ['epic', 'status:to-test'], association: 'OWNER' }

test('ok → verified', () => {
  assert.deepEqual(decideTestReply({ ...base, body: 'ok' }), { act: true, result: 'ok', note: '' })
})
test('not ok: note → failed with the note', () => {
  const d = decideTestReply({ ...base, body: 'not ok: login button does nothing' })
  assert.equal(d.result, 'not-ok')
  assert.equal(d.note, 'login button does nothing')
})
test('ignored unless the card is awaiting a test', () => {
  assert.equal(decideTestReply({ ...base, labels: ['epic'], body: 'ok' }).act, false)
})
test('ignored from a non-collaborator', () => {
  assert.equal(decideTestReply({ ...base, association: 'NONE', body: 'ok' }).act, false)
})
test('ordinary chatter is not a verdict', () => {
  assert.equal(decideTestReply({ ...base, body: "it's ok I guess" }).act, false)
})
test('failure issue carries the note, the epic link and a dedup line', () => {
  const { title, body } = buildFailureIssue({ epicNumber: 7, note: 'x broke' })
  assert.match(title, /#7/)
  assert.match(body, /Part of #7/)
  assert.match(body, /> x broke/)
  assert.match(body, /Dedup-checked:/)
})

const kid = (number, state) => ({ number, state })
test('epic close: children closed + epic PR merged → close', () => {
  assert.deepEqual(decideEpicClose({ subIssues: [kid(1, 'closed')], prs: [{ number: 9, state: 'closed', merged_at: 'x' }] }), { close: true })
})
test('epic close: open epic PR stays open and is named', () => {
  const r = decideEpicClose({ subIssues: [kid(1, 'closed')], prs: [{ number: 9, state: 'open' }] })
  assert.equal(r.close, false)
  assert.match(r.comment, /#9/)
})
test('epic close: open sub-issue stays open and is named', () => {
  const r = decideEpicClose({ subIssues: [kid(4, 'open')], prs: [] })
  assert.equal(r.close, false)
  assert.match(r.comment, /#4/)
})

// ── preview pins (#3052) ──────────────────────────────────────────────────────
import { decidePin, buildPinIssue, appendPin, PIN_MARKER } from './handle-test-reply.mjs'
import { routeComment } from './comment-route.mjs'
import { readFileSync } from 'node:fs'

const PIN = '🎯 **Preview feedback**\n\n- **Component:** `a/B.vue`\n\n> too tight'
const bot = { labels: ['epic', 'status:to-test'], body: PIN, userType: 'Bot', association: 'NONE' }

test('first pin on a to-test epic → pin-first', () => {
  assert.equal(decidePin(bot).result, 'pin-first')
})
test('later pin (epic failed, pin issue exists) → pin-more', () => {
  const d = decidePin({ ...bot, labels: ['epic', 'status:failed'], pinIssue: { number: 9 } })
  assert.equal(d.result, 'pin-more')
})
test('pin on an epic that is not under test is ignored', () => {
  assert.equal(decidePin({ ...bot, labels: ['epic'] }).act, false)
  assert.equal(decidePin({ ...bot, labels: ['epic', 'status:failed'] }).act, false)
})
test('pin from a stranger (not bot, not collaborator) is ignored', () => {
  assert.equal(decidePin({ ...bot, userType: 'User' }).act, false)
})
test('pin issue carries the pins and append splices before the end marker', () => {
  const { title, body } = buildPinIssue({ epicNumber: 7, pins: [PIN] })
  assert.match(title, /#7/)
  assert.ok(body.includes(PIN_MARKER))
  const b2 = appendPin(body, '🎯 **Preview feedback**\n\n> second')
  assert.match(b2, /> > second\n<!-- \/preview-pins -->/)
  assert.match(b2, /too tight/)
})
test('routing: a bot pin on a to-test epic reaches the test-card job; elsewhere it does not', () => {
  const r = (labels, userType = 'Bot') => routeComment({ comment: { body: PIN, authorAssociation: 'NONE', userType }, issue: { number: 7, isPr: false, labels } }).kind
  assert.equal(r(['status:to-test']), 'test-card')
  assert.equal(r(['status:failed']), 'test-card')
  assert.equal(r([]), 'none')
  assert.equal(r(['status:to-test'], 'User'), 'none')
})
test('workflow: the route job admits a pin, and the test-card step passes the commenter type', () => {
  const y = readFileSync(new URL('../.github/workflows/on-comment.yml', import.meta.url), 'utf8')
  assert.match(y, /startsWith\(github\.event\.comment\.body, '🎯 \*\*Preview feedback\*\*'\)/)
  assert.match(y, /COMMENT_USER_TYPE: \$\{\{ github\.event\.comment\.user\.type \}\}/)
})
