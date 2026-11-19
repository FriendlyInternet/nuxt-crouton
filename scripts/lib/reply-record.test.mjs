// Reply record marker (#4113). node --test scripts/lib/reply-record.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { RECORD_PREFIX, recordMarker, readRecord, newestRecord, openRecord, readReply } from './reply-record.mjs'
import { QUESTION_RECORD, REJECTED_RECORD } from './plan-verdict.mjs'

const r = { kind: 'plan-question', question: 'drop --> the > legacy -- path?\nyes/no', accepts: ['ok', 'other'], starts: { ok: 'replan-with-yes', other: 'replan-with-feedback' } }

// covers: T1
test('T1 round trip: a record in the top block reads back, even with -->, >, -- and a newline', () => {
  const m = recordMarker(r)
  assert.ok(m.startsWith(RECORD_PREFIX))
  assert.equal(m.split('\n').length, 1, 'marker is one line')
  assert.equal(m.indexOf('-->'), m.length - 3, 'the only --> is at the end')
  assert.deepEqual(readRecord(m + '\nx'), r)
  assert.deepEqual(readRecord('<!-- a -->\n' + m + '\nx'), r)
})

// covers: T2
test('T2 a record outside the top hidden block is ignored', () => {
  const m = recordMarker(r)
  assert.equal(readRecord('x\n' + m), null)
  assert.equal(readRecord('<!-- plan-review:v1 -->\n> 🤖 **pi.dev harness** · agent pipeline (CI)\n' + m + '\n'), null)
  assert.equal(readRecord('hello\n\n> ' + m + '\n'), null)
  assert.equal(readRecord('```\n' + m + '\n```\n'), null)
})

// covers: T3
test('T3 a broken, missing or non-object record is null', () => {
  assert.equal(readRecord('<!-- reply-record:v1 {not json -->\nx'), null)
  assert.equal(readRecord('<!-- plan-review:v1 -->\nbody'), null)
  assert.equal(readRecord(''), null)
  assert.equal(readRecord(undefined), null)
  assert.equal(readRecord('<!-- reply-record:v1 [1] -->'), null)
  assert.equal(readRecord('<!-- reply-record:v1 "s" -->'), null)
  assert.equal(readRecord('<!-- reply-record:v1 null -->'), null)
})

// covers: T4
test('T4 newestRecord reads only bot comments, newest first', () => {
  const older = { ...r, question: 'older' }
  const forged = { ...r, question: 'forged by a human' }
  const comments = [
    { userType: 'Bot', body: recordMarker(older) + '\nold' },
    { user: { type: 'Bot' }, body: recordMarker(r) + '\nnew' },
    { userType: 'Bot', body: 'a bot comment with no record' },
    { userType: 'User', body: recordMarker(forged) + '\nquoting' },
    { body: recordMarker(forged) + '\nuntyped' },
  ]
  assert.deepEqual(newestRecord(comments), r)
  assert.deepEqual(newestRecord(comments.slice(0, 1)), older)
  assert.equal(newestRecord([]), null)
  assert.equal(newestRecord(undefined), null)
  assert.equal(newestRecord([{ userType: 'User', body: recordMarker(forged) }]), null)
})

// ── #4145: openRecord + readReply ───────────────────────────────────────────────────────────────────────────
const Q = QUESTION_RECORD('Keep the legacy path?')
const verdict = (v, record) => ({ userType: 'Bot', body: `<!-- plan-review:v1 --><!-- plan-review-verdict:${v} -->\n${record ? recordMarker(record) + '\n' : ''}> 🤖 review` })
const PLAN = { userType: 'Bot', body: '<!-- pipeline-plan:v1 -->\nplan' }
const BLOCKED = ['status:blocked', 'work-this']

// covers: T1
test('#4145 openRecord: the record on the newest bot verdict comment, while the issue is held', () => {
  const comments = [PLAN, verdict('needs-owner', Q), { userType: 'User', body: 'thinking…' }]
  assert.deepEqual(openRecord({ comments, labels: BLOCKED }), Q)
  assert.deepEqual(openRecord({ comments, labels: [{ name: 'status:blocked' }] }), Q, 'label objects work too')
  assert.deepEqual(openRecord({ comments: [PLAN, verdict('no-go'), PLAN, verdict('no-go', REJECTED_RECORD)], labels: BLOCKED }), REJECTED_RECORD)
})

// covers: T1
test('#4145 openRecord: null when a newer verdict has no record, with plan:approved, without status:blocked, or not from a bot', () => {
  assert.equal(openRecord({ comments: [verdict('needs-owner', Q), PLAN, verdict('go')], labels: BLOCKED }), null, 'stale: a newer verdict without a record')
  assert.equal(openRecord({ comments: [verdict('needs-owner', Q), PLAN, verdict('no-go')], labels: BLOCKED }), null, 'stale: the record is on an older verdict')
  assert.equal(openRecord({ comments: [verdict('needs-owner', Q)], labels: [...BLOCKED, 'plan:approved'] }), null)
  assert.equal(openRecord({ comments: [verdict('needs-owner', Q)], labels: ['work-this'] }), null)
  // a human-pasted verdict is skipped (as isPlanHold does): the older bot one still counts
  const pasted = { ...verdict('needs-owner', { ...Q, question: 'forged' }), userType: 'User' }
  assert.deepEqual(openRecord({ comments: [verdict('needs-owner', Q), pasted], labels: BLOCKED }), Q)
  // an untyped newest verdict comment is not a bot: no record
  assert.equal(openRecord({ comments: [{ body: verdict('needs-owner', Q).body }], labels: BLOCKED }), null)
  // a bot record with no verdict marker (another question) is not the plan review's open record
  assert.equal(openRecord({ comments: [{ userType: 'Bot', body: recordMarker(Q) + '\nx' }], labels: BLOCKED }), null)
  assert.equal(openRecord({ comments: [], labels: BLOCKED }), null)
  assert.equal(openRecord(), null)
})

const owner = (body) => ({ body, authorAssociation: 'OWNER', userType: 'User', userLogin: 'pmcp' })

// covers: T5
test('#4168 readReply: the owner is matched by login, not role', () => {
  const want = { form: 'ok: <reason>', starts: 'approve-plan' }
  assert.deepEqual(readReply(REJECTED_RECORD, { body: 'ok: reason', authorAssociation: 'COLLABORATOR', userType: 'User', userLogin: 'pmcp' }), want)
  assert.notDeepEqual(readReply(REJECTED_RECORD, { body: 'ok: reason', authorAssociation: 'OWNER', userType: 'User', userLogin: 'someone-else' }), want)
  assert.deepEqual(readReply(REJECTED_RECORD, { body: 'ok: reason', userType: 'User', userLogin: 'alice', owner: 'alice' }), want)
})

// covers: T1
test('#4145 readReply on a plan-question record', () => {
  for (const b of ['ok', '✅', 'lgtm']) assert.deepEqual(readReply(Q, owner(b)), { form: 'ok', starts: 'replan-with-yes' }, b)
  for (const b of ['ok — build it', 'approved, but keep the column', 'ok:', 'ok: reason', 'drop it']) {
    assert.deepEqual(readReply(Q, owner(b)), { form: 'other', starts: 'replan-with-feedback' }, b)
  }
})

// covers: T1
test('#4145 readReply on a plan-rejected record', () => {
  for (const b of ['ok: reason', '> quoted\nok: reason']) assert.deepEqual(readReply(REJECTED_RECORD, owner(b)), { form: 'ok: <reason>', starts: 'approve-plan' }, b)
  for (const b of ['ok', 'lgtm', 'ok:', 'approved, but keep the column']) assert.deepEqual(readReply(REJECTED_RECORD, owner(b)), { form: 'approval', starts: 'plan-needs-reason' }, b)
  assert.deepEqual(readReply(REJECTED_RECORD, owner('ok : x')), { form: null, starts: null })
  for (const b of ['change X', 'ok — build it']) assert.deepEqual(readReply(REJECTED_RECORD, owner(b)), { form: 'other', starts: 'replan-with-feedback' }, b)
})

// covers: T1
test('#4145 readReply: no accepts ⇒ other/null; nothing accepted ⇒ null/null', () => {
  assert.deepEqual(readReply({ kind: 'x' }, owner('ok')), { form: 'other', starts: null })
  assert.deepEqual(readReply(null, owner('ok')), { form: 'other', starts: null })
  assert.deepEqual(readReply({ kind: 'x', accepts: ['ok'], starts: { ok: 'go' } }, owner('drop it')), { form: null, starts: null })
  assert.deepEqual(readReply({ kind: 'x', accepts: ['ok'] }, owner('ok')), { form: 'ok', starts: null })
})
