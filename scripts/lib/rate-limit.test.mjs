import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isRateLimitError, rateLimitResetAt, deferOrThrow } from './rate-limit.mjs'

const err = (status, message, headers) => Object.assign(new Error(message), { status, response: { headers } })

test('classifier: true cases', () => {
  assert.equal(isRateLimitError(err(403, 'x', { 'x-ratelimit-remaining': '0' })), true)
  assert.equal(isRateLimitError(err(403, 'x', { 'x-ratelimit-remaining': 0 })), true)
  assert.equal(isRateLimitError(err(429, 'slow down')), true)
  assert.equal(isRateLimitError(err(403, 'API rate limit exceeded for installation ID 141712327')), true)
})

test('classifier: false cases', () => {
  assert.equal(isRateLimitError(err(403, 'Resource not accessible by integration', { 'x-ratelimit-remaining': '4000' })), false)
  assert.equal(isRateLimitError(err(422, 'merge conflict')), false)
  assert.equal(isRateLimitError(err(405, 'Base branch was modified')), false)
  assert.equal(isRateLimitError(null), false)
  assert.equal(isRateLimitError(new Error('boom')), false)
})

test('rateLimitResetAt', () => {
  assert.equal(rateLimitResetAt(err(403, 'x', { 'x-ratelimit-reset': '1793721949' })), new Date(1793721949000).toISOString())
  assert.equal(rateLimitResetAt(err(403, 'x', {})), null)
})

test('deferOrThrow defers a rate limit with the reset time', () => {
  const calls = []
  deferOrThrow(err(403, 'API rate limit exceeded', { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1793721949' }), m => calls.push(m))
  assert.equal(calls.length, 1)
  assert.match(calls[0], new RegExp(new Date(1793721949000).toISOString()))
})

test('deferOrThrow rethrows real failures and never warns', () => {
  for (const e of [err(403, 'Resource not accessible by integration'), err(422, 'conflict'), new Error('boom')]) {
    const calls = []
    assert.throws(() => deferOrThrow(e, m => calls.push(m)), x => x === e)
    assert.equal(calls.length, 0)
  }
})

import { rateLimitNote } from './rate-limit.mjs'
import { test as t3306 } from 'node:test'
import assert3306 from 'node:assert/strict'

const rl = (status, reset) => ({ status, message: 'API rate limit exceeded', response: { headers: reset ? { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(reset) } : {} } })

t3306('rateLimitNote: reset header gives HH:MM and epoch marker', () => {
  const n = rateLimitNote(rl(403, 1700000000))
  assert3306.match(n.body, /after 22:13 UTC/)
  assert3306.equal(n.marker, '<!-- rate-limit-retry:1700000000 -->')
  assert3306.equal(rateLimitNote(rl(403, 1700000000)).marker, n.marker)
})
t3306('rateLimitNote: no header gives generic note', () => {
  const n = rateLimitNote(rl(429))
  assert3306.equal(n.marker, '<!-- rate-limit-retry -->')
  assert3306.doesNotMatch(n.body, /UTC/)
})
