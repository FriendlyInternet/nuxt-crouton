import { test } from 'node:test'
import assert from 'node:assert/strict'
import { decideDeliverable } from './run-deliverable.mjs'

test('#3131 replay: commit pushed onto an existing PR is a deliverable', () => {
  assert.deepEqual(decideDeliverable({ linkedPR: false, workBranchPushed: true }), { ok: true, via: 'work-branch' })
})

test('no signals → not ok (still pages)', () => {
  assert.equal(decideDeliverable({}).ok, false)
})

test('each signal alone passes with its own via', () => {
  assert.equal(decideDeliverable({ linkedPR: true }).via, 'linked-pr')
  assert.equal(decideDeliverable({ signoffHeld: true }).via, 'signoff-held')
  assert.equal(decideDeliverable({ alreadyClosed: true }).via, 'already-closed')
  assert.equal(decideDeliverable({ createdSubIssues: true }).via, 'sub-issues')
  assert.equal(decideDeliverable({ childDeliverable: 'child #1 closed' }).via, 'child')
})

test('precedence is stable when several are true', () => {
  assert.equal(decideDeliverable({ linkedPR: true, workBranchPushed: true, signoffHeld: true }).via, 'linked-pr')
  assert.equal(decideDeliverable({ workBranchPushed: true, signoffHeld: true }).via, 'work-branch')
})
