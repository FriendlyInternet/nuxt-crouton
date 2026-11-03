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

// ── #3251 case 11: API usage per run ──
import { readRateLimit, diffRateLimit } from './rate-limit.mjs'

test('diffRateLimit: same reset window → remaining difference', () => {
  assert.deepEqual(diffRateLimit({ remaining: 4000, reset: 100 }, { remaining: 3700, reset: 100 }), { api_calls: 300, reason: null })
})

test('diffRateLimit: reset window rolled over → null', () => {
  assert.deepEqual(diffRateLimit({ remaining: 4000, reset: 100 }, { remaining: 4900, reset: 200 }), { api_calls: null, reason: 'reset-window-changed' })
})

test('diffRateLimit: failed reads → null with reason', () => {
  assert.deepEqual(diffRateLimit({ error: 'x' }, { remaining: 1, reset: 1 }), { api_calls: null, reason: 'start-read-failed' })
  assert.deepEqual(diffRateLimit({ remaining: 1, reset: 1 }, { error: 'x' }), { api_calls: null, reason: 'end-read-failed' })
})

test('readRateLimit: parses resources.core; never throws', async () => {
  const ok = async () => ({ ok: true, status: 200, json: async () => ({ resources: { core: { remaining: 4000, reset: 100, limit: 5000 } } }) })
  assert.deepEqual(await readRateLimit('t', { fetchImpl: ok }), { remaining: 4000, reset: 100, limit: 5000 })
  const boom = async () => { throw new Error('network down') }
  assert.deepEqual(await readRateLimit('t', { fetchImpl: boom }), { error: 'network down' })
  const forbidden = async () => ({ ok: false, status: 403 })
  assert.deepEqual(await readRateLimit('t', { fetchImpl: forbidden }), { error: 'HTTP 403' })
})
