/**
 * Test Sign-Off gate (#774) artifact for #2101 — the FAILING test proposed first,
 * before dedupFindings() is implemented. Held on issue #2101 for owner `lgtm`/`approve`
 * before the implementation lands.
 *
 *   node --test .claude/skills/review-sweep/dedup.test.mjs
 *
 * Cases, in plain language:
 *   1. A finding matching an already-open backlog item by (file, description) is dropped.
 *   2. A finding matching nothing prior is kept.
 *   3. A re-run with an identical finding set against its own prior output nets zero kept
 *      (idempotent — running the sweep twice with no code change adds nothing).
 *   4. Severity/wording differences on the same (file, description) pair still count as
 *      the same finding — dedup keys on (file, description), not exact object equality.
 *   5. Different files with the same description are distinct findings (both kept, unless
 *      each already has its own prior match).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dedupFindings } from './dedup.mjs'

test('a finding matching an existing item by (file, description) is dropped', () => {
  const existing = [{ file: 'src/foo.ts', description: 'unused export `bar`' }]
  const fresh = [{ file: 'src/foo.ts', description: 'unused export `bar`', severity: 'blue' }]
  const { kept, dropped } = dedupFindings(fresh, existing)
  assert.deepEqual(kept, [])
  assert.deepEqual(dropped, fresh)
})

test('a finding matching nothing prior is kept', () => {
  const existing = [{ file: 'src/foo.ts', description: 'unused export `bar`' }]
  const fresh = [{ file: 'src/baz.ts', description: 'duplicate logic with src/qux.ts' }]
  const { kept, dropped } = dedupFindings(fresh, existing)
  assert.deepEqual(kept, fresh)
  assert.deepEqual(dropped, [])
})

test('re-running with an identical finding set nets zero net new (idempotent)', () => {
  const priorSweep = [{ file: 'src/foo.ts', description: 'unused export `bar`' }]
  const { kept } = dedupFindings(priorSweep, priorSweep)
  assert.deepEqual(kept, [])
})

test('severity/wording differences on the same (file, description) key are still a match', () => {
  const existing = [{ file: 'src/foo.ts', description: 'unused export `bar`', severity: 'blue' }]
  const fresh = [{ file: 'src/foo.ts', description: 'unused export `bar`', severity: 'red' }]
  const { kept, dropped } = dedupFindings(fresh, existing)
  assert.deepEqual(kept, [])
  assert.equal(dropped.length, 1)
})

test('same description in a different file is a distinct finding', () => {
  const existing = [{ file: 'src/foo.ts', description: 'unused export `bar`' }]
  const fresh = [{ file: 'src/other.ts', description: 'unused export `bar`' }]
  const { kept, dropped } = dedupFindings(fresh, existing)
  assert.deepEqual(kept, fresh)
  assert.deepEqual(dropped, [])
})

test('a mixed batch splits correctly between kept and dropped', () => {
  const existing = [{ file: 'src/foo.ts', description: 'unused export `bar`' }]
  const fresh = [
    { file: 'src/foo.ts', description: 'unused export `bar`' }, // dup
    { file: 'src/new.ts', description: 'god function, 400 lines' } // new
  ]
  const { kept, dropped } = dedupFindings(fresh, existing)
  assert.deepEqual(kept, [fresh[1]])
  assert.deepEqual(dropped, [fresh[0]])
})
