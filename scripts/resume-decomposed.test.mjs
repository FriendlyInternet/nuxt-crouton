/**
 * #2048 contract — an already-decomposed issue is never a leaf.
 *
 * The case that minted this: epic #515 had three open, ready children (#516/#517/#518)
 * and was classified as a single leaf, so the single-leaf worker spent eleven minutes
 * on an epic and produced nothing. The classification never looked at the sub-issues.
 *
 *   node --test scripts/resume-decomposed.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { planResume } from './resume-decomposed.mjs'

const open = (number, body = '') => ({ number, state: 'open', body })
const closed = (number, body = '') => ({ number, state: 'closed', body })

test('the real #515 shape resumes instead of classifying', () => {
  const v = planResume([open(516), open(517), open(518)])
  assert.equal(v.resume, true)
  assert.deepEqual(v.dispatch.map(d => d.number), [516, 517, 518])
  assert.ok(v.dispatch.every(d => d.label === 'work-this'))
})

test('no sub-issues → classify normally (the common case must not regress)', () => {
  const v = planResume([])
  assert.equal(v.resume, false)
  assert.equal(v.dispatch.length, 0)
  assert.match(v.reason, /not decomposed/)
})

test('a FINISHED tree classifies normally — a closed tree is not a tree to resume', () => {
  // Otherwise an epic whose children all merged could never take new leaf work.
  const v = planResume([closed(516), closed(517)])
  assert.equal(v.resume, false)
  assert.match(v.reason, /closed/)
})

test('a partially-finished tree resumes only what is still open', () => {
  const v = planResume([closed(516), open(517), open(518)])
  assert.equal(v.resume, true)
  assert.deepEqual(v.dispatch.map(d => d.number), [517, 518])
})

test('a child blocked by an OPEN sibling waits (#1750 ordering is respected)', () => {
  const v = planResume([open(516), open(517, 'Blocked-by: #516')])
  assert.deepEqual(v.dispatch.map(d => d.number), [516])
  assert.deepEqual(v.waiting, [517])
})

test('a child whose blocker has CLOSED is dispatched', () => {
  const v = planResume([closed(516), open(517, 'Blocked-by: #516')])
  assert.deepEqual(v.dispatch.map(d => d.number), [517])
  assert.deepEqual(v.waiting, [])
})

test('a blocker OUTSIDE this tree does not wedge the child forever', () => {
  // Nothing in this tree can ever close #999, so treating it as live would park the
  // child permanently with no event able to release it.
  const v = planResume([open(517, 'Blocked-by: #999')])
  assert.deepEqual(v.dispatch.map(d => d.number), [517])
})

test('a child that is itself decomposed goes back to the DECOMPOSER, not a code worker', () => {
  const v = planResume([{ ...open(517), hasOpenChildren: true }, open(518)])
  assert.equal(v.dispatch.find(d => d.number === 517).label, 'delegate-pi')
  assert.equal(v.dispatch.find(d => d.number === 518).label, 'work-this')
})

test('an all-blocked tree still reports resume=true — it must not fall through to the LEAF TEST', () => {
  // This is the subtle one: "nothing to dispatch right now" is NOT "this is a leaf".
  // Falling through here would recreate the exact #515 bug on a cycle-free but fully
  // serialised tree.
  const v = planResume([open(516, 'Blocked-by: #517'), open(517, 'Blocked-by: #516')])
  assert.equal(v.resume, true)
  assert.equal(v.dispatch.length, 0)
  assert.deepEqual(v.waiting, [516, 517])
})

test('null/garbage entries are tolerated, not thrown on', () => {
  assert.equal(planResume([null, undefined, open(516)]).dispatch.length, 1)
  assert.equal(planResume(undefined).resume, false)
})
