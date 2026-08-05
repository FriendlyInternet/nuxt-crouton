/**
 * Tests for the accountability scoreboard (#1570).
 *   node --test scripts/eval-ledger/accountability.test.mjs
 *
 * The scoring model is asymmetric and easy to get subtly wrong, so the arithmetic
 * is pinned here: caught −w/+w, escaped heavier, rejected debits the gate, pending
 * moves nothing, and a clean merge earns +1.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { transactionsFor, validate, dedupKey, SEVERITY_WEIGHT, ESCAPE_MULT } from './findings-schema.mjs'
import { tally } from './accountability.mjs'
import { reconcile } from './reconcile-findings.mjs'
import { resolveCandidates } from './ingest-findings.mjs'

const finding = (over = {}) => ({
  ts: '2026-07-12T00:00:00Z',
  gate: 'code-review',
  severity: 'high',
  author_ref: 'https://x/pull/1',
  author_flow: 'task-worker',
  status: 'confirmed',
  confirmed_via: 'fix-merged',
  escaped: false,
  missed_gate: null,
  finding_ref: null,
  notes: null,
  ...over,
})

const ledgerRow = (over = {}) => ({
  ts: '2026-07-12T00:00:00Z', flow: 'task-worker', skill: null, harness: 'claude',
  model: 'anthropic/x', cost_usd: null, turns: null, wall_s: null,
  artifact_gate: 'pass', ci: 'pass', outcome: 'merged', human: null,
  fix_rounds: null, ref: 'https://x/pull/9', notes: null, ...over,
})

// ── transactionsFor: the four scoring cases ──────────────────────────────────
test('caught defect: author −w, gate +w', () => {
  const tx = transactionsFor(finding({ severity: 'critical' }))
  const w = SEVERITY_WEIGHT.critical
  assert.deepEqual(tx.find((t) => t.role === 'author'), { agent: 'task-worker', role: 'author', delta: -w })
  assert.deepEqual(tx.find((t) => t.role === 'gate'), { agent: 'code-review', role: 'gate', delta: +w })
})

test('escaped defect: author pays ESCAPE_MULT×w, catcher +w, missed_gate −w', () => {
  const tx = transactionsFor(finding({
    escaped: true, gate: 'human-revert', missed_gate: 'code-review', confirmed_via: 'reverted',
  }))
  const w = SEVERITY_WEIGHT.high
  assert.deepEqual(tx.find((t) => t.role === 'author'), { agent: 'task-worker', role: 'author', delta: -w * ESCAPE_MULT })
  assert.deepEqual(tx.find((t) => t.agent === 'human-revert'), { agent: 'human-revert', role: 'gate', delta: +w })
  assert.deepEqual(tx.find((t) => t.agent === 'code-review'), { agent: 'code-review', role: 'gate', delta: -w })
})

test('rejected (false-positive): gate −w, author untouched', () => {
  const tx = transactionsFor(finding({ status: 'rejected' }))
  assert.equal(tx.length, 1)
  assert.deepEqual(tx[0], { agent: 'code-review', role: 'gate', delta: -SEVERITY_WEIGHT.high })
})

test('pending finding scores nothing', () => {
  assert.deepEqual(transactionsFor(finding({ status: 'pending' })), [])
})

// ── tally: the two leaderboards + clean-merge reward ─────────────────────────
test('acceptance: confirmed 🔴 code-review → task-worker −5, code-review +5', () => {
  const { authors, gates } = tally([finding({ severity: 'critical' })], [])
  assert.equal(authors.find((a) => a.agent === 'task-worker').net, -5)
  assert.equal(authors.find((a) => a.agent === 'task-worker').defects, 1)
  assert.equal(gates.find((g) => g.agent === 'code-review').net, 5)
  assert.equal(gates.find((g) => g.agent === 'code-review').catches, 1)
})

test('pending finding does not move the board', () => {
  const { authors, gates } = tally([finding({ status: 'pending' })], [])
  assert.equal(authors.length, 0)
  assert.equal(gates.length, 0)
})

test('clean merge earns the author +1', () => {
  const { authors } = tally([], [ledgerRow()])
  const a = authors.find((x) => x.agent === 'task-worker')
  assert.equal(a.net, 1)
  assert.equal(a.clean, 1)
})

test('a merged run WITH a confirmed defect on its ref earns no clean reward', () => {
  const ref = 'https://x/pull/42'
  const { authors } = tally(
    [finding({ author_ref: ref, severity: 'low' })],
    [ledgerRow({ ref })],
  )
  const a = authors.find((x) => x.agent === 'task-worker')
  // −1 defect, no +1 clean reward (the merged run is the dirty one).
  assert.equal(a.clean, 0)
  assert.equal(a.net, -SEVERITY_WEIGHT.low)
})

test('reverted / non-merged runs earn no clean reward', () => {
  const { authors } = tally([], [ledgerRow({ outcome: 'reverted', flow: 'decompose-spike' })])
  assert.equal(authors.length, 0)
})

test('authors sorted worst-first by defect-rate; gates best-first by net', () => {
  const findings = [
    finding({ author_flow: 'sloppy', author_ref: 'r1', severity: 'high' }),
    finding({ author_flow: 'sloppy', author_ref: 'r2', severity: 'high' }),
    finding({ author_flow: 'okay', author_ref: 'r3', severity: 'low' }),
  ]
  const ledger = [ledgerRow({ flow: 'okay', ref: 'clean1' }), ledgerRow({ flow: 'okay', ref: 'clean2' })]
  const { authors } = tally(findings, ledger)
  assert.equal(authors[0].agent, 'sloppy') // 100% defect rate
  assert.ok(authors[0].rate > authors[1].rate)
})

// ── validate: attribution + enum guards ──────────────────────────────────────
test('validate rejects a confirmed caught finding with nothing to blame', () => {
  const res = validate({ ts: '2026-07-12T00:00:00Z', gate: 'code-review', status: 'confirmed' })
  assert.equal(res.ok, false)
  assert.ok(res.errors.some((e) => e.includes('author_ref') || e.includes('author_flow')))
})

test('validate fills defaults and coerces escaped to a boolean', () => {
  const res = validate({ ts: '2026-07-12T00:00:00Z', gate: 'code-review', status: 'pending' })
  assert.equal(res.ok, true)
  assert.equal(res.record.severity, 'medium')
  assert.equal(res.record.escaped, false)
})

// ── dedupKey: identity is stable across a pending→confirmed transition ────────
test('dedupKey ignores status; separates caught vs escaped on the same ref', () => {
  const base = { gate: 'code-review', author_ref: 'r1', author_flow: null }
  assert.equal(dedupKey({ ...base, status: 'pending', escaped: false }), dedupKey({ ...base, status: 'confirmed', escaped: false }))
  assert.notEqual(dedupKey({ ...base, escaped: false }), dedupKey({ ...base, escaped: true }))
})

// ── reconcile: reverted ledger rows → escaped findings, idempotent ───────────
test('reconcile derives an escaped finding from a reverted run', () => {
  const ledger = [ledgerRow({ outcome: 'reverted', flow: 'decompose-spike', ref: 'https://x/pull/862' })]
  const add = reconcile(ledger, [])
  assert.equal(add.length, 1)
  assert.equal(add[0].escaped, true)
  assert.equal(add[0].gate, 'revert')
  assert.equal(add[0].author_flow, 'decompose-spike')
})

test('reconcile skips a ref that already has an escaped finding (any gate)', () => {
  const ledger = [ledgerRow({ outcome: 'reverted', flow: 'decompose-spike', ref: 'https://x/pull/862' })]
  const existing = [finding({ gate: 'human-revert', escaped: true, author_ref: 'https://x/pull/862' })]
  assert.deepEqual(reconcile(ledger, existing), [])
})

test('reconcile ignores non-reverted outcomes', () => {
  assert.deepEqual(reconcile([ledgerRow({ outcome: 'merged' }), ledgerRow({ outcome: 'abandoned' })], []), [])
})

// ── resolveCandidates: merge confirms, close drops, open skips ────────────────
const candidate = (over = {}) => ({
  ts: '2026-07-12T00:00:00Z', gate: 'frontend-review', severity: 'critical',
  author_ref: 'https://x/pull/999', author_flow: 'task-worker', status: 'pending',
  escaped: false, missed_gate: null, finding_ref: null, notes: null, _pr: 999, ...over,
})

test('resolveCandidates: merged PR → confirmed caught finding', () => {
  const { toAppend, outcomes } = resolveCandidates([candidate()], { 999: 'merged' }, [])
  assert.equal(toAppend.length, 1)
  assert.equal(toAppend[0].status, 'confirmed')
  assert.equal(toAppend[0].confirmed_via, 'fix-merged')
  assert.equal(toAppend[0]._pr, undefined) // the internal field is stripped
  assert.equal(outcomes[0].outcome, 'confirmed')
})

test('resolveCandidates: closed PR drops, open PR skips', () => {
  const { toAppend, outcomes } = resolveCandidates(
    [candidate({ _pr: 1 }), candidate({ _pr: 2 })],
    { 1: 'closed', 2: 'open' }, [],
  )
  assert.equal(toAppend.length, 0)
  assert.deepEqual(outcomes.map((o) => o.outcome), ['dropped', 'skipped'])
})

test('resolveCandidates is idempotent against already-recorded findings', () => {
  const existing = [validate({ ...candidate(), status: 'confirmed', confirmed_via: 'fix-merged' }).record]
  const { toAppend, outcomes } = resolveCandidates([candidate()], { 999: 'merged' }, existing)
  assert.equal(toAppend.length, 0)
  assert.equal(outcomes[0].outcome, 'dup')
})

// ── quality lane (/simplify): separate, never dilutes the defect board (#1570) ─
test('class defaults to defect and is enum-validated', () => {
  assert.equal(validate({ ts: '2026-07-12T00:00:00Z', gate: 'code-review', status: 'pending' }).record.class, 'defect')
  assert.equal(validate({ ts: '2026-07-12T00:00:00Z', gate: 'x', status: 'pending', class: 'bogus' }).ok, false)
})

test('dedupKey separates a quality finding from a defect one on the same gate+ref', () => {
  const base = { gate: 'g', author_ref: 'r', escaped: false }
  assert.notEqual(dedupKey({ ...base, class: 'defect' }), dedupKey({ ...base, class: 'quality' }))
})

test('quality findings stay OUT of the defect board and clean-merge math', () => {
  const q = finding({ class: 'quality', gate: 'simplify', severity: 'low', author_flow: 'task-worker', author_ref: 'https://x/pull/7' })
  const { authors, gates, qualityGates } = tally([q], [ledgerRow({ flow: 'task-worker', ref: 'https://x/pull/7' })])
  const a = authors.find((x) => x.agent === 'task-worker')
  // Quality did NOT count as a defect: net is the +1 clean reward, defects 0, but qualityFixes 1.
  assert.equal(a.defects, 0)
  assert.equal(a.net, 1)
  assert.equal(a.clean, 1)
  assert.equal(a.qualityFixes, 1)
  // /simplify shows in the quality lane, never the defect gates board.
  assert.equal(gates.find((g) => g.agent === 'simplify'), undefined)
  assert.equal(qualityGates.find((g) => g.agent === 'simplify').net, SEVERITY_WEIGHT.low)
  assert.equal(qualityGates.find((g) => g.agent === 'simplify').fixes, 1)
})
