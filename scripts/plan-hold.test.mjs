import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isPlanHold, resumeOutcome } from './plan-hold.mjs'

const bot = (body) => ({ body, userType: 'Bot' })
const person = (body) => ({ body, userType: 'User' })
const NOGO = '<!-- plan-review:v1 -->\n<!-- plan-review-verdict:no-go -->\n🔴 **Plan rejected twice**'
const GO = '<!-- plan-review-verdict:go -->'
const PLAN = '<!-- pipeline-plan:v1 -->\nplan'

// The real shape of #3057/#3058/#3061 (11:44-11:47Z) and #3131/#3132/#3138/#3139/#3140: plan,
// no-go, re-plan, no-go (held, no hold marker), then the owner's guidance and the generic reply.
const heldThread = () => [
  bot(PLAN), bot(NOGO), bot(PLAN), bot(NOGO),
  person('Use the existing helper instead.'),
  bot('✅ **Resumed from your reply** — still iterating'),
]

test('two no-go reviews, newest a no-go ⇒ plan hold', () => {
  assert.equal(isPlanHold(heldThread()), true)
})

test('replayed real held threads each re-plan, never "still iterating"', () => {
  for (const id of [3057, 3058, 3061, 3131, 3132, 3138, 3139, 3140]) {
    const comments = heldThread()
    assert.equal(isPlanHold(comments), true, `#${id}`)
    assert.equal(resumeOutcome({ planHold: true, dispatched: true, newComment: true }), 'replan', `#${id}`)
  }
})

test('a single no-go (round 1 re-plans by itself) is not a hold', () => {
  assert.equal(isPlanHold([bot(PLAN), bot(NOGO)]), false)
})

test('a later go verdict ends the hold', () => {
  assert.equal(isPlanHold([...heldThread(), bot(PLAN), bot(GO)]), false)
})

test('a person pasting the marker does not make a hold', () => {
  assert.equal(isPlanHold([person(NOGO), person(NOGO)]), false)
})

test('design-hold / gate-PR threads without verdicts are not plan holds', () => {
  assert.equal(isPlanHold([bot('🎨 Design sign-off needed before building')]), false)
  assert.equal(isPlanHold([]), false)
  assert.equal(isPlanHold(undefined), false)
})

test('plan hold, nothing dispatched, nothing posted ⇒ nothing (the 🔴 outcome)', () => {
  assert.equal(resumeOutcome({ planHold: true, dispatched: false, newComment: false }), 'nothing')
})

test('not a plan hold ⇒ existing behaviour', () => {
  assert.equal(resumeOutcome({ planHold: false, dispatched: false, newComment: false }), 'ok')
})
