import { test } from 'node:test'
import assert from 'node:assert/strict'
import { needsWaitingLabel } from './traffic-waiting-backfill.mjs'

const W = { body: 'x <!-- traffic-wait -->' }
const R = { body: 'x <!-- traffic-released -->' }
test('needsWaitingLabel', () => {
  assert.equal(needsWaitingLabel([W]), true)
  assert.equal(needsWaitingLabel([W, R]), false)
  assert.equal(needsWaitingLabel([W, R, W]), true)
  assert.equal(needsWaitingLabel([{ body: 'hi' }]), false)
})
