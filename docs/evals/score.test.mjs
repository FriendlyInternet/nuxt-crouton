import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { scoreAnswer, summarize, extractCliCommands } from './score.mjs'

const { questions } = JSON.parse(readFileSync(new URL('./questions.json', import.meta.url), 'utf8'))
// Stand-in validator (node core only here); the REAL one is exercised in scripts/eval-score.deps-test.mjs.
const stubValidate = ({ schema }) => {
  const errors = Object.entries(schema).filter(([, f]) => !f || !f.type).map(([k]) => `Field "${k}" is missing the "type" property`)
  return { valid: errors.length === 0, errors, warnings: [] }
}
const ctx = { validateSchema: stubValidate }
const bike = questions.find(q => q.id === 'bike-rental-schema')

test('question set is well formed with unique ids', () => {
  assert.ok(questions.length >= 10)
  assert.equal(new Set(questions.map(q => q.id)).size, questions.length)
  for (const q of questions) assert.ok(q.question && Array.isArray(q.mustMention))
})

test('good bike schema passes', () => {
  const a = 'Here:\n```json\n{"type":{"type":"string","meta":{"displayAs":"optionsSelect","options":["city"]}}}\n```'
  assert.equal(scoreAnswer(bike, a, ctx).pass, true)
})

test('schema with readonly/children fails', () => {
  const a = '```json\n{"type":{"type":"string","readonly":true,"meta":{"displayAs":"optionsSelect"}}}\n```'
  const r = scoreAnswer(bike, a, ctx)
  assert.equal(r.pass, false)
  assert.ok(r.failures.some(f => f.includes('readonly')))
})

test('no JSON in a schema question fails', () => {
  assert.equal(scoreAnswer(bike, 'use optionsSelect', ctx).pass, false)
})

test('banned-key-free but invalid schema fails (reviewer example)', () => {
  const r = scoreAnswer(bike, 'Never use optionsSelect.\n```json\n{"a":1}\n```', ctx)
  assert.equal(r.pass, false)
  assert.ok(r.failures.some(f => f.startsWith('no valid schema')))
})

test('unknown CLI command is flagged, known one is not', () => {
  const q = { id: 'x', kind: 'prose', mustMention: [] }
  assert.deepEqual(extractCliCommands('Run `crouton frobnicate` or\n```bash\ncrouton config\n```'), ['frobnicate', 'config'])
  assert.equal(scoreAnswer(q, 'Run `crouton config`', { cliCommands: ['config'] }).pass, true)
  assert.equal(scoreAnswer(q, 'Run `crouton frobnicate`', { cliCommands: ['config'] }).pass, false)
})

test('summarize', () => {
  assert.deepEqual(summarize([{ pass: true }, { pass: false }]), { passed: 1, total: 2, score: 0.5 })
})
