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
  assert.deepEqual(decideEpicClose({ subIssues: [kid(1, 'closed')], prs: [{ number: 9, state: 'closed', merged_at: 'x' }], postmortem: 'done' }), { close: true })
})
test('epic close: open epic PR stays open and is named', () => {
  const r = decideEpicClose({ subIssues: [kid(1, 'closed')], prs: [{ number: 9, state: 'open' }], postmortem: 'done' })
  assert.equal(r.close, false)
  assert.match(r.comment, /#9/)
})
test('epic close: open sub-issue stays open and is named', () => {
  const r = decideEpicClose({ subIssues: [kid(4, 'open')], prs: [], postmortem: 'done' })
  assert.equal(r.close, false)
  assert.match(r.comment, /#4/)
})

// #3425: a verified epic waits for its postmortem; a skipped postmortem never blocks the close.
const merged = [{ number: 9, state: 'closed', merged_at: 'x' }]
test('epic close: everything done but no postmortem → pending, not closed', () => {
  const r = decideEpicClose({ subIssues: [kid(1, 'closed')], prs: merged, postmortem: null })
  assert.equal(r.close, false)
  assert.equal(r.pending, true)
  assert.match(r.comment, /postmortem is running/)
})
test('epic close: no postmortem argument at all → pending (the default is null)', () => {
  assert.equal(decideEpicClose({ subIssues: [kid(1, 'closed')], prs: merged }).pending, true)
})
test('epic close: postmortem done → close', () => {
  assert.deepEqual(decideEpicClose({ subIssues: [kid(1, 'closed')], prs: merged, postmortem: 'done' }), { close: true })
})
test('epic close: postmortem skipped → close (never blocks)', () => {
  assert.deepEqual(decideEpicClose({ subIssues: [kid(1, 'closed')], prs: merged, postmortem: 'skipped' }), { close: true })
})
test('epic close: open sub-issue still wins over pending', () => {
  const r = decideEpicClose({ subIssues: [kid(4, 'open')], prs: [], postmortem: null })
  assert.equal(r.close, false)
  assert.equal(r.pending, undefined)
  assert.match(r.comment, /#4/)
})
