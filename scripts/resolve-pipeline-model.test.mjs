// The pure model-resolution rule (#2161). A wrong model breaks every dispatch, so these pin
// the contract: a valid tier returns its configured model; anything unusable throws (so the
// CLI exits non-zero and the workflow's `|| echo <fallback>` takes over — never an empty model).
//   node --test scripts/resolve-pipeline-model.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveModel, VALID_TIERS } from './resolve-pipeline-model.mjs'

const CFG = { provider: 'pi-claude-cli', default: 'claude-sonnet-5', hard: 'claude-opus-4-8' }

test('default tier resolves to the configured default model', () => {
  assert.equal(resolveModel(CFG, 'default'), 'claude-sonnet-5')
})

test('hard tier resolves to the configured hard model', () => {
  assert.equal(resolveModel(CFG, 'hard'), 'claude-opus-4-8')
})

test('a model value is trimmed', () => {
  assert.equal(resolveModel({ default: '  claude-sonnet-5  ' }, 'default'), 'claude-sonnet-5')
})

test('an unknown tier throws (never silently returns a wrong/empty model)', () => {
  assert.throws(() => resolveModel(CFG, 'medium'), /tier must be one of/)
  assert.throws(() => resolveModel(CFG, ''), /tier must be one of/)
  assert.throws(() => resolveModel(CFG, undefined), /tier must be one of/)
})

test('a tier missing from the config throws', () => {
  assert.throws(() => resolveModel({ default: 'x' }, 'hard'), /no model configured for tier 'hard'/)
})

test('an empty / non-string model throws rather than passing an unusable value through', () => {
  assert.throws(() => resolveModel({ default: '' }, 'default'), /no model configured/)
  assert.throws(() => resolveModel({ default: '   ' }, 'default'), /no model configured/)
  assert.throws(() => resolveModel({ default: 123 }, 'default'), /no model configured/)
})

test('a non-object config throws', () => {
  assert.throws(() => resolveModel(null, 'default'), /config must be an object/)
})

test('VALID_TIERS is exactly the two the pipeline uses', () => {
  assert.deepEqual(VALID_TIERS, ['default', 'hard'])
})

// The committed config must itself be resolvable for both tiers — a broken checked-in file
// would make every dispatch fall back. Reads the REAL file (this test runs from the repo root).
test('the committed .claude/pipeline-models.json resolves both tiers', async () => {
  const { readFileSync } = await import('node:fs')
  const cfg = JSON.parse(readFileSync('.claude/pipeline-models.json', 'utf8'))
  for (const tier of VALID_TIERS) {
    const m = resolveModel(cfg, tier)
    assert.match(m, /^claude-/, `${tier} should be a Claude subscription model (#1669), got ${m}`)
  }
})
