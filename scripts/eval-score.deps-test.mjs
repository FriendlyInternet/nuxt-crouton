// Needs installed packages + a built crouton-mcp (dist): scores answers with the REAL
// validate_schema validator and the whole question set through the real runner entry point.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { scoreAnswer } from '../docs/evals/score.mjs'
// Built output, resolved at runtime (dist is not in the static import graph)
const validator = new URL('../packages/crouton-mcp/dist/tools/validate-schema.js', import.meta.url).href
const { handleValidateSchema } = await import(validator)

const { questions } = JSON.parse(readFileSync(new URL('../docs/evals/questions.json', import.meta.url), 'utf8'))
const bike = questions.find(q => q.id === 'bike-rental-schema')
const ctx = { validateSchema: handleValidateSchema }

test('real validator: reviewer example (banned-key-free, invalid schema) fails', () => {
  const r = scoreAnswer(bike, 'Never use optionsSelect.\n```json\n{"a":1}\n```', ctx)
  assert.equal(r.pass, false)
  assert.ok(r.failures.some(f => f.startsWith('no valid schema')), r.failures.join('; '))
})

test('real validator: a valid bike schema passes', () => {
  const a = 'Use optionsSelect:\n```json\n{"name":{"type":"string","meta":{"required":true,"maxLength":100}},"type":{"type":"string","meta":{"displayAs":"optionsSelect","maxLength":20}},"dailyPrice":{"type":"decimal","meta":{"precision":10,"scale":2}},"available":{"type":"boolean"}}\n```'
  assert.equal(scoreAnswer(bike, a, ctx).pass, true)
})

test('real runner: schema question answered with an invalid schema fails end to end', () => {
  const dir = mkdtempSync(join(tmpdir(), 'evals-'))
  const qf = join(dir, 'q.json'); const fake = join(dir, 'f.mjs')
  writeFileSync(qf, JSON.stringify({ questions: [bike] }))
  writeFileSync(fake, `globalThis.fetch = async () => ({ ok: true, json: async () => ({ content: [{ type: 'text', text: 'Never use optionsSelect.\\n\`\`\`json\\n{"a":1}\\n\`\`\`' }] }) })`)
  const r = spawnSync(process.execPath, ['--import', fake, fileURLToPath(new URL('../docs/evals/run.mjs', import.meta.url)), '--questions', qf], {
    env: { ...process.env, ANTHROPIC_API_KEY: 'k' }, encoding: 'utf8'
  })
  assert.equal(r.status, 1, r.stderr)
  assert.match(r.stdout, /^FAIL bike-rental-schema — no valid schema/m)
})
