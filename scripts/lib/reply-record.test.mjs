// Reply record marker (#4113). node --test scripts/lib/reply-record.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { RECORD_PREFIX, recordMarker, readRecord, newestRecord } from './reply-record.mjs'

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
