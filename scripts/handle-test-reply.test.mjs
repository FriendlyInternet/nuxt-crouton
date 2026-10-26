// The owner's reply to a test card (#2542). A wrong verdict marks an epic verified/failed wrongly.
//   node --test scripts/handle-test-reply.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { decideTestReply, buildFailureIssue } from './handle-test-reply.mjs'

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
