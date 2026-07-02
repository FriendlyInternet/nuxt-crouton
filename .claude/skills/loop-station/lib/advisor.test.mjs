/**
 * Tests for the WS5 advisor gate (#933).
 *   node --test .claude/skills/loop-station/lib/advisor.test.mjs
 *
 * The advisor is the deterministic "should we bother the human?" gate, so its
 * decisions must be predictable: reds + sharp growth flag; a quiet/baseline state
 * stays silent; deltas across different tokenizers are NOT compared.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { analyze, ADVISOR } from '../advisor.mjs'

const rec = (over = {}) => ({
  commit: over.commit || 'abc1234',
  pr: over.pr ?? null,
  tokenizer: over.tokenizer || 'anthropic',
  totals: { alwaysOnTokens: over.tokens ?? 10000 },
  redundancy: { pct: over.red ?? 5, topPairs: [] },
  scorecard: {
    overall: over.overall || 'green',
    length: { score: over.lengthBand || 'green', alwaysOnTokens: over.tokens ?? 10000, oversized: [] },
    redundancy: { score: over.redBand || 'green', pct: over.red ?? 5 },
    driftRisk: { score: over.driftBand || 'green', pairs: over.drift ?? 0, examples: [] }
  }
})

test('no records → not actionable', () => {
  const r = analyze([])
  assert.equal(r.actionable, false)
  assert.equal(r.findings.length, 0)
})

test('all-green single point → silent (nothing to report)', () => {
  const r = analyze([rec()])
  assert.equal(r.actionable, false)
})

test('scorecard red bands surface as findings', () => {
  const r = analyze([rec({ lengthBand: 'red', redBand: 'red', driftBand: 'red', overall: 'red' })])
  assert.equal(r.actionable, true)
  const dims = r.findings.map((f) => f.dim).sort()
  assert.deepEqual(dims, ['drift-risk', 'length', 'redundancy'])
})

test('sharp always-on growth (same tokenizer) flags a growth finding', () => {
  const prev = rec({ tokens: 10000 })
  const next = rec({ tokens: 10000 + ADVISOR.growthTokens + 1 })
  const r = analyze([prev, next])
  const growth = r.findings.find((f) => f.dim === 'growth')
  assert.ok(growth, 'growth finding present')
  assert.equal(growth.evidence.to, 10000 + ADVISOR.growthTokens + 1)
})

test('growth across DIFFERENT tokenizers is NOT compared (no false alarm)', () => {
  const prev = rec({ tokens: 10000, tokenizer: 'heuristic' })
  const next = rec({ tokens: 18000, tokenizer: 'anthropic' }) // big jump but ruler changed
  const r = analyze([prev, next])
  assert.ok(!r.findings.some((f) => f.dim === 'growth'), 'no growth finding across tokenizers')
})

test('redundancy jump (same tokenizer) flags', () => {
  const prev = rec({ red: 5 })
  const next = rec({ red: 5 + ADVISOR.redundancyJumpPct + 1 })
  const r = analyze([prev, next])
  assert.ok(r.findings.some((f) => f.dim === 'redundancy-growth'))
})

test('analyze is deterministic', () => {
  const input = [rec({ tokens: 10000 }), rec({ lengthBand: 'red', tokens: 20000 })]
  assert.deepEqual(analyze(input), analyze(input))
})

// ── Dead-weight rule (#1066): oversized skill × provably zero CI invocations ──
// The rule may only judge with real coverage: cumulative window ≥ 60d AND ≥ 5
// observed runs. Anything thinner ⇒ silent, with `usage.why` naming the reason —
// "no data" must never read as "dead".

const artifact = (name, tokens, kind = 'skill') => ({ path: `.claude/skills/${name}/SKILL.md`, kind, name, tokens })

const usageRec = (over = {}) => ({
  schema: 1,
  generatedAt: over.generatedAt || '2026-07-06T06:41:00.000Z',
  windowDays: over.windowDays ?? 7,
  source: 'ci-rollup',
  scope: 'pipeline',
  runs: over.runs ?? 3,
  workflows: over.workflows || ['claude.yml'],
  events: over.events ?? 10,
  byName: over.byName || {}
})

// 10 weekly records ⇒ 70d coverage, 30 runs — comfortably past both gates.
const coveredWindow = (byName = {}) => Array.from({ length: 10 }, () => usageRec({ byName }))

test('dead-weight: big + never fired in a covered window → finding with scope + window', () => {
  const hist = rec()
  hist.artifacts = [artifact('big-idle', 5000), artifact('big-live', 5000), artifact('small-idle', 1000)]
  const r = analyze([hist], coveredWindow({ 'big-live': { kind: 'skill', count: 4 } }))
  const dw = r.findings.find((f) => f.dim === 'dead-weight')
  assert.ok(dw, 'dead-weight finding present')
  assert.deepEqual(dw.evidence.candidates.map((c) => c.name), ['big-idle'], 'fired and small skills are not candidates')
  assert.equal(dw.evidence.scope, 'pipeline')
  assert.equal(dw.evidence.coverageDays, 70)
  assert.equal(r.actionable, true)
})

test('dead-weight: no usage records → never judged (no finding, why says so)', () => {
  const hist = rec()
  hist.artifacts = [artifact('big-idle', 5000)]
  const r = analyze([hist])
  assert.ok(!r.findings.some((f) => f.dim === 'dead-weight'))
  assert.equal(r.usage.judged, false)
  assert.match(r.usage.why, /no usage rollup/)
})

test('dead-weight: thin coverage (< 60d) → not judged', () => {
  const hist = rec()
  hist.artifacts = [artifact('big-idle', 5000)]
  const r = analyze([hist], [usageRec({ runs: 50 })]) // one week only
  assert.ok(!r.findings.some((f) => f.dim === 'dead-weight'))
  assert.match(r.usage.why, /coverage 7d/)
})

test('dead-weight: run-starved window (< 5 runs) → not judged even at 60d+', () => {
  const hist = rec()
  hist.artifacts = [artifact('big-idle', 5000)]
  const quiet = Array.from({ length: 10 }, () => usageRec({ runs: 0, events: 0 }))
  const r = analyze([hist], quiet)
  assert.ok(!r.findings.some((f) => f.dim === 'dead-weight'))
  assert.match(r.usage.why, /runs/)
})

test('dead-weight: a skill fired in ANY covered week is not dead', () => {
  const hist = rec()
  hist.artifacts = [artifact('big-once', 5000)]
  const recs = coveredWindow()
  recs[3] = usageRec({ byName: { 'big-once': { kind: 'skill', count: 1 } } })
  const r = analyze([hist], recs)
  assert.ok(!r.findings.some((f) => f.dim === 'dead-weight'))
})

test('dead-weight: only skills are judged, agents/claudemd are not', () => {
  const hist = rec()
  hist.artifacts = [artifact('task-worker', 9000, 'agent'), { path: 'CLAUDE.md', kind: 'claudemd', tokens: 19000 }]
  const r = analyze([hist], coveredWindow())
  assert.ok(!r.findings.some((f) => f.dim === 'dead-weight'))
})
