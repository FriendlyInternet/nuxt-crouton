import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ratesFor, costForUsage, tokensForUsage } from './anthropic-pricing.mjs'

test('model id resolves to the right rates (longest substring wins)', () => {
  assert.deepEqual(ratesFor('claude-sonnet-5'), { input: 3, output: 15 })
  assert.deepEqual(ratesFor('claude-opus-4-8'), { input: 15, output: 75 })
  assert.deepEqual(ratesFor('claude-haiku-4-5-20251001'), { input: 1, output: 5 })
})

test('unknown model falls back to sonnet-class rates', () => {
  assert.deepEqual(ratesFor('some-future-model'), { input: 3, output: 15 })
  assert.deepEqual(ratesFor(null), { input: 3, output: 15 })
})

test('input + output priced per Mtoken', () => {
  // 1M input + 1M output on sonnet = 3 + 15 = $18
  assert.equal(costForUsage({ input_tokens: 1e6, output_tokens: 1e6 }, 'claude-sonnet-5'), 18)
})

test('cache tiers: creation = 1.25x input, read = 0.1x input', () => {
  // 1M cache-write @ sonnet = 1.25 * 3 = $3.75
  assert.equal(costForUsage({ cache_creation_input_tokens: 1e6 }, 'sonnet'), 3.75)
  // 1M cache-read @ sonnet = 0.1 * 3 = $0.30
  assert.equal(Math.round(costForUsage({ cache_read_input_tokens: 1e6 }, 'sonnet') * 100) / 100, 0.3)
})

test('opus is 5x sonnet on both axes', () => {
  assert.equal(costForUsage({ input_tokens: 1e6, output_tokens: 1e6 }, 'claude-opus-4-8'), 90)
})

test('empty/missing usage is $0 and 0 tokens', () => {
  assert.equal(costForUsage(null, 'sonnet'), 0)
  assert.equal(costForUsage({}, 'sonnet'), 0)
  assert.equal(tokensForUsage(null), 0)
})

test('tokensForUsage sums all four tiers', () => {
  assert.equal(
    tokensForUsage({ input_tokens: 10, output_tokens: 20, cache_creation_input_tokens: 30, cache_read_input_tokens: 40 }),
    100
  )
})
