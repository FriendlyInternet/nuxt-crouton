/**
 * #2755 — the plan comment's shape, incl. the assumption rule (each needs a why + linked evidence).
 *   node --test scripts/lib/plan-shape.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parsePlan, parseAssumptions, PLAN_MARKER } from './plan-shape.mjs'

const A_OK = '- The bug is in foo — Why: the stack trace ends there — Evidence: https://github.com/o/r/blob/abc/foo.ts#L10 — Status: verified'

const plan = (over = {}) => {
  const s = {
    Reproduced: 'yes — ran `pnpm test foo`, saw a TypeError',
    Cause: 'foo.ts:10 reads undefined',
    Fix: 'guard the read',
    Files: '- foo.ts',
    Test: 'foo.test.ts',
    Assumptions: A_OK,
    'Needs owner': 'no — mechanical',
    ...over,
  }
  return PLAN_MARKER + '\n' + Object.entries(s).filter(([, v]) => v !== null).map(([k, v]) => `### ${k}\n${v}`).join('\n\n')
}

test('a complete plan parses', () => {
  const r = parsePlan(plan())
  assert.deepEqual(r.errors, [])
  assert.equal(r.reproduced, true)
  assert.equal(r.needsOwner, false)
  assert.equal(r.assumptions.length, 1)
})

test('missing marker and missing section are rejected', () => {
  assert.ok(parsePlan(plan().replace(PLAN_MARKER, '')).errors.some((e) => /marker/.test(e)))
  assert.ok(parsePlan(plan({ Fix: null })).errors.some((e) => /Fix/.test(e)))
})

test('Reproduced: no needs a concrete reason, and flags the plan unverified', () => {
  assert.ok(parsePlan(plan({ Reproduced: 'no' })).errors.some((e) => /Reproduced/.test(e)))
  const r = parsePlan(plan({ Reproduced: 'no — needs a prod-only D1 row we cannot seed here' }))
  assert.equal(r.ok, true)
  assert.equal(r.unverified, true)
})

test('assumptions: "none" is allowed, empty is not', () => {
  assert.equal(parsePlan(plan({ Assumptions: 'none' })).ok, true)
  assert.equal(parsePlan(plan({ Assumptions: '' })).ok, false)
  assert.equal(parsePlan(plan({ Assumptions: 'we think it is fine' })).ok, false)
})

test('an assumption with no why is malformed', () => {
  const r = parseAssumptions('- claim — Evidence: https://x.dev/a — Status: verified')
  assert.ok(r.errors.some((e) => /Why/.test(e)))
})

test('an assumption with no evidence is malformed', () => {
  const r = parseAssumptions('- claim — Why: because — Status: unverified')
  assert.ok(r.errors.some((e) => /Evidence/.test(e)))
})

test('a verified assumption needs a link; an unverified one only needs a reason', () => {
  assert.ok(parseAssumptions('- c — Why: w — Evidence: I looked — Status: verified').errors.some((e) => /linked proof/.test(e)))
  assert.deepEqual(parseAssumptions('- c — Why: w — Evidence: no prod access to check — Status: unverified').errors, [])
})

test('status must be verified or unverified', () => {
  assert.ok(parseAssumptions('- c — Why: w — Evidence: https://x.dev — Status: probably').errors.some((e) => /Status/.test(e)))
})

// #3149 — a re-plan (--revised) must carry a "Ticket re-read" section.
const REREAD_OK = '- Ship the flag — Covered: Fix step 1\n- Count rejections — Not covered: later manual post'

test('revised: missing Ticket re-read is an error', () => {
  const r = parsePlan(plan(), { revised: true })
  assert.equal(r.ok, false)
  assert.ok(r.errors.some((e) => e.includes('Ticket re-read')))
})

test('revised: section with no bullets is an error', () => {
  const r = parsePlan(plan({ 'Ticket re-read': 'I read it.' }), { revised: true })
  assert.equal(r.ok, false)
})

test('revised: bullet with neither Covered nor Not covered is an error', () => {
  const r = parsePlan(plan({ 'Ticket re-read': '- Ship the flag' }), { revised: true })
  assert.equal(r.ok, false)
})

test('revised: valid section passes and is returned', () => {
  const r = parsePlan(plan({ 'Ticket re-read': REREAD_OK }), { revised: true })
  assert.deepEqual(r.errors, [])
  assert.equal(r.reread.length, 2)
  assert.equal(r.reread[1].covered, false)
})

test('first plan without the section still passes', () => {
  assert.equal(parsePlan(plan()).ok, true)
})

test('first plan with the section present passes', () => {
  assert.equal(parsePlan(plan({ 'Ticket re-read': REREAD_OK })).ok, true)
})

test('CLI: --revised before or after the file fails a plan missing the section', () => {
  const dir = mkdtempSync(join(tmpdir(), 'plan-'))
  const f = join(dir, 'p.md')
  writeFileSync(f, plan())
  const script = fileURLToPath(new URL('./plan-shape.mjs', import.meta.url))
  assert.equal(spawnSync('node', [script, '--revised', f]).status, 1)
  assert.equal(spawnSync('node', [script, f, '--revised']).status, 1)
  assert.equal(spawnSync('node', [script, f]).status, 0)
})
