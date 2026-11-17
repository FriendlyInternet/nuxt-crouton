import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loginRetryDecision, loginRetryDelays, LOGIN_RETRY_DELAYS_MS } from './smoke-login.mjs'

test('loginRetryDecision: 2xx is ok', () => {
  assert.equal(loginRetryDecision({ status: 200, attempt: 1, maxAttempts: 4 }), 'ok')
})

test('loginRetryDecision: 5xx retries until the last attempt', () => {
  assert.equal(loginRetryDecision({ status: 503, attempt: 1, maxAttempts: 4 }), 'retry')
  assert.equal(loginRetryDecision({ status: 503, attempt: 4, maxAttempts: 4 }), 'give-up')
})

test('loginRetryDecision: a thrown fetch error retries', () => {
  assert.equal(loginRetryDecision({ threw: new Error('ECONNRESET'), attempt: 1, maxAttempts: 4 }), 'retry')
})

test('loginRetryDecision: 4xx is never retried', () => {
  assert.equal(loginRetryDecision({ status: 401, attempt: 1, maxAttempts: 4 }), 'give-up')
  assert.equal(loginRetryDecision({ status: 429, attempt: 1, maxAttempts: 4 }), 'give-up')
})

test('loginRetryDelays: env override, garbage falls back to the default', () => {
  assert.deepEqual(loginRetryDelays({ SMOKE_LOGIN_RETRY_DELAYS_MS: '10,20' }), [10, 20])
  assert.deepEqual(loginRetryDelays({ SMOKE_LOGIN_RETRY_DELAYS_MS: 'abc,5' }), LOGIN_RETRY_DELAYS_MS)
  assert.deepEqual(loginRetryDelays({}), [2000, 5000, 10000])
})
