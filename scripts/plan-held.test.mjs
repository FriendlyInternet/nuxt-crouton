import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isPlanHeld } from './plan-held.mjs'

const bot = (body) => ({ body, userType: 'Bot' })
const plan = bot('<!-- pipeline-plan:v1 --> plan')
const hold = bot('<!-- plan-review-verdict:no-go -->\n🔴 **Plan rejected twice** — held')
const reject1 = bot('<!-- plan-review-verdict:no-go -->\n🔴 Plan rejected — sent back')

test('held: the newest event is the twice-rejected verdict', () => {
  assert.equal(isPlanHeld([plan, reject1, plan, hold]), true)
})
test('not held: a first rejection only sends the plan back', () => {
  assert.equal(isPlanHeld([plan, reject1]), false)
})
test('not held: a newer plan after the hold cancels it', () => {
  assert.equal(isPlanHeld([plan, hold, plan]), false)
})
test('not held: a person pasting the markers is ignored', () => {
  assert.equal(isPlanHeld([plan, { body: hold.body, userType: 'User' }]), false)
})
test('not held: no comments', () => {
  assert.equal(isPlanHeld([]), false)
})
