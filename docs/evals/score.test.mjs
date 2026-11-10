import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { scoreAnswer, summarize } from './score.mjs'

const { questions } = JSON.parse(readFileSync(new URL('./questions.json', import.meta.url), 'utf8'))
const bike = questions.find(q => q.id === 'bike-rental-schema')

test('question set is well formed with unique ids', () => {
  assert.ok(questions.length >= 10)
  assert.equal(new Set(questions.map(q => q.id)).size, questions.length)
  for (const q of questions) assert.ok(q.question && Array.isArray(q.mustMention))
})

test('good bike schema passes', () => {
  const a = 'Here:\n```json\n{"type":{"type":"string","meta":{"displayAs":"optionsSelect","options":["city"]}}}\n```'
  assert.equal(scoreAnswer(bike, a).pass, true)
})

test('schema with readonly/children fails', () => {
  const a = '```json\n{"type":{"type":"string","readonly":true,"meta":{"displayAs":"optionsSelect"}}}\n```'
  const r = scoreAnswer(bike, a)
  assert.equal(r.pass, false)
  assert.ok(r.failures.some(f => f.includes('readonly')))
})

test('no JSON in a schema question fails', () => {
  assert.equal(scoreAnswer(bike, 'use optionsSelect').pass, false)
})

test('summarize', () => {
  assert.deepEqual(summarize([{ pass: true }, { pass: false }]), { passed: 1, total: 2, score: 0.5 })
})
