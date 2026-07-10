import { test } from 'node:test'
import assert from 'node:assert/strict'
import { classify, runCanary, ALERT_STATES } from './provider-key-canary.mjs'

const anthropicDry = JSON.stringify({
  type: 'error',
  error: { type: 'invalid_request_error', message: 'Your credit balance is too low to access the Anthropic API.' },
})
const openaiQuota = JSON.stringify({
  error: { message: 'You exceeded your current quota', type: 'insufficient_quota', code: 'insufficient_quota' },
})
const openaiRateLimit = JSON.stringify({ error: { message: 'Rate limit reached', type: 'rate_limit_error' } })
const badKey = JSON.stringify({ error: { type: 'authentication_error', message: 'invalid x-api-key' } })

test('classify: 200 → ok', () => {
  assert.equal(classify(200, '{}').state, 'ok')
})

test('classify: Anthropic out-of-credit (400) → dry', () => {
  assert.equal(classify(400, anthropicDry).state, 'dry')
})

test('classify: OpenAI insufficient_quota is a 429 but must read as DRY, not ratelimited', () => {
  // The load-bearing edge: OpenAI signals "out of credit" with HTTP 429. The billing
  // check must win over the 429 check or a dead key looks like a transient blip.
  assert.equal(classify(429, openaiQuota).state, 'dry')
})

test('classify: a genuine 429 rate-limit → ratelimited (transient, NOT an alert)', () => {
  const r = classify(429, openaiRateLimit)
  assert.equal(r.state, 'ratelimited')
  assert.equal(ALERT_STATES.has(r.state), false)
})

test('classify: bad key → auth', () => {
  assert.equal(classify(401, badKey).state, 'auth')
  assert.equal(classify(200, '{}').state !== 'auth', true)
})

test('classify: unknown 500 → error', () => {
  assert.equal(classify(500, 'upstream boom').state, 'error')
})

test('dry + auth are the only alerting states', () => {
  assert.deepEqual([...ALERT_STATES].sort(), ['auth', 'dry'])
})

test('runCanary: unconfigured provider is skipped, not alerted', async () => {
  const summary = await runCanary([{ id: 'ghost', keyEnv: 'DEFINITELY_UNSET_KEY_XYZ', probe: async () => ({ status: 200, text: async () => '{}' }) }])
  assert.equal(summary.results[0].state, 'unconfigured')
  assert.equal(summary.ok, true)
})

test('runCanary: a dry provider drives ok=false and names the key', async () => {
  process.env.__FAKE_KEY = 'x'
  const summary = await runCanary([
    { id: 'fakeprov', keyEnv: '__FAKE_KEY', probe: async () => ({ status: 400, text: async () => anthropicDry }) },
  ])
  assert.equal(summary.ok, false)
  assert.deepEqual(summary.alerting, ['fakeprov'])
  delete process.env.__FAKE_KEY
})

test('runCanary: a network throw surfaces as error (canary noise), not a false all-clear alert', async () => {
  process.env.__FAKE_KEY2 = 'x'
  const summary = await runCanary([
    { id: 'neterr', keyEnv: '__FAKE_KEY2', probe: async () => { throw new Error('ENOTFOUND api.example') } },
  ])
  assert.equal(summary.results[0].state, 'error')
  assert.equal(summary.ok, true) // error is not an alert state; it doesn't cry "key dry"
  delete process.env.__FAKE_KEY2
})
