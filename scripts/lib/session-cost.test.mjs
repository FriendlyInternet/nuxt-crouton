import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseUsageLine, costFromText } from './session-cost.mjs'

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

test('mixed/empty is handled; pi role tagged as message still counts', () => {
  assert.deepEqual(costFromText(''), { usd: 0, tokens: 0, turns: 0, model: null, exact: true })
  // pi line has top-level type:'message' — must NOT be filtered out
  assert.equal(costFromText(piLine(2)).turns, 1)
})
