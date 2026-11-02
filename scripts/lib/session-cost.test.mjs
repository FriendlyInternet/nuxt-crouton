import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseUsageLine, costFromText, costForPiUsage } from './session-cost.mjs'
import { costForUsage } from './anthropic-pricing.mjs'

const piLine = (cost) =>
  JSON.stringify({ type: 'message', message: { role: 'assistant', usage: { cost: { total: cost }, input_tokens: 100 } } })
const claudeLine = (usage, model = 'claude-sonnet-5') =>
  JSON.stringify({ type: 'assistant', message: { role: 'assistant', model, usage } })

test('parseUsageLine: skips non-assistant + non-usage + junk lines', () => {
  assert.equal(parseUsageLine('{ not json'), null)
  assert.equal(parseUsageLine(JSON.stringify({ type: 'user', message: { role: 'user' } })), null)
  assert.equal(parseUsageLine(JSON.stringify({ message: { role: 'assistant' } })), null) // no usage
  assert.ok(parseUsageLine(piLine(0.5))) // assistant + usage → parsed
})

test('pi session: EXACT cost from usage.cost.total (verbatim, not recomputed)', () => {
  const text = [piLine(0.5), piLine(1.25)].join('\n')
  const r = costFromText(text)
  assert.equal(r.usd, 1.75)
  assert.equal(r.turns, 2)
  assert.equal(r.exact, true)
})

test('claude session: COMPUTED cost from tokens (marks exact=false)', () => {
  // 1M input + 1M output @ sonnet = $18
  const text = claudeLine({ input_tokens: 1e6, output_tokens: 1e6 })
  const r = costFromText(text)
  assert.equal(r.usd, 18)
  assert.equal(r.exact, false)
})

test('claude dedup: the same message.id logged 3× counts ONCE (#1268 overcount fix)', () => {
  const dupLine = JSON.stringify({
    type: 'assistant',
    message: { role: 'assistant', id: 'msg_ABC', model: 'claude-sonnet-5', usage: { input_tokens: 1e6, output_tokens: 1e6 } }
  })
  const text = [dupLine, dupLine, dupLine].join('\n') // Claude Code logs the turn 3×
  const r = costFromText(text)
  assert.equal(r.turns, 1) // not 3
  assert.equal(r.usd, 18) // $18 once, not $54
})

test('mixed/empty is handled; pi role tagged as message still counts', () => {
  assert.deepEqual(costFromText(''), { usd: 0, estimatedUsd: 0, tokens: 0, turns: 0, model: null, exact: true })
  // pi line has top-level type:'message' — must NOT be filtered out
  assert.equal(costFromText(piLine(2)).turns, 1)
})

const piTok = (cost, model, u = { input: 1000, output: 2000, cacheRead: 5000, cacheWrite: 300 }) =>
  JSON.stringify({ type: 'message', message: { role: 'assistant', model, usage: { ...u, cost: { total: cost } } } })
const expected = (model, u = { input: 1000, output: 2000, cacheRead: 5000, cacheWrite: 300 }) =>
  costForUsage(
    { input_tokens: u.input, output_tokens: u.output, cache_read_input_tokens: u.cacheRead, cache_creation_input_tokens: u.cacheWrite },
    model
  )

test('pi cost 0 + tokens → priced via table, flagged as estimate (#3158)', () => {
  const r = costFromText(piTok(0, 'claude-sonnet-5'))
  assert.ok(r.usd > 0)
  assert.equal(r.usd, Math.round(expected('claude-sonnet-5') * 1e6) / 1e6)
  assert.equal(r.estimatedUsd, r.usd)
  assert.equal(r.exact, false)
  assert.equal(r.tokens, 8300)
})

test('pi cost > 0 stays verbatim, estimatedUsd 0', () => {
  const r = costFromText(piTok(0.42, 'claude-sonnet-5'))
  assert.equal(r.usd, 0.42)
  assert.equal(r.estimatedUsd, 0)
})

test('one reported + one computed turn → estimatedUsd is only the computed part', () => {
  const r = costFromText([piTok(0.5, 'claude-sonnet-5'), piTok(0, 'claude-sonnet-5')].join('\n'))
  assert.equal(r.estimatedUsd, Math.round(expected('claude-sonnet-5') * 1e6) / 1e6)
  assert.equal(r.usd, Math.round((0.5 + expected('claude-sonnet-5')) * 1e6) / 1e6)
})

test('mixed models priced per turn', () => {
  const r = costFromText([piTok(0, 'claude-sonnet-5'), piTok(0, 'claude-haiku-4-5')].join('\n'))
  assert.equal(r.usd, Math.round((expected('claude-sonnet-5') + expected('claude-haiku-4-5')) * 1e6) / 1e6)
  assert.equal(costForPiUsage({ input: 1e6 }, 'claude-sonnet-5'), costForUsage({ input_tokens: 1e6 }, 'claude-sonnet-5'))
})
