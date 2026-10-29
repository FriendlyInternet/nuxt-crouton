import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isPlanHeld, overrideReason } from './plan-held.mjs'

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

test('overrideReason: needs `ok:`/`lgtm:` opening the reply and at least three words', () => {
  assert.equal(overrideReason('ok: the reviewer misread the schema'), 'the reviewer misread the schema')
  assert.equal(overrideReason('LGTM: scope is fine here'), 'scope is fine here')
  assert.equal(overrideReason('ok'), '')
  assert.equal(overrideReason('ok: fine'), '')
  assert.equal(overrideReason('I said ok: the reviewer misread it'), '')
  assert.equal(overrideReason('> ok: the reviewer misread it'), '')
})
