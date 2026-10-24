/**
 * #1730 contract — a parked test must link an issue, not an excuse.
 *
 * Minted by the #1703 postmortem: `useTeam.test.ts` carried
 * `it.todo(..., /* TODO: nanostore mock complexity - tracked for future refactoring *\/)` for
 * months with no issue number. The diagnosis in that comment was also wrong — the code under
 * test could never run at all — so the excuse discouraged exactly the re-examination that
 * would have found the real (product) bug.
 *
 *   node --test scripts/check-parked-tests.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { findParkedTests, hasIssueRef, formatReport } from './check-parked-tests.mjs'

test('flags it.todo with no issue reference anywhere nearby', () => {
  const found = findParkedTests(`
    describe('useTeam', () => {
      // TODO: Better Auth nanostore mock complexity - tracked for future refactoring
      it.todo('should return currentTeam when active organization exists', () => {})
    })
  `)
  assert.equal(found.length, 1)
  assert.equal(found[0].kind, 'it.todo')
  assert.equal(found[0].linked, false)
})

test('accepts an issue number in a comment block directly above the call', () => {
  const found = findParkedTests(`
    // blocked-by: #1713
    it.todo('should return currentTeam when active organization exists', () => {})
  `)
  assert.equal(found[0].linked, true)
})

test('accepts an issue number inline in the call itself, even multi-line', () => {
  const found = findParkedTests(`
    it.todo(
      'should return currentTeam when active organization exists', // see #1713
      () => {}
    )
  `)
  assert.equal(found[0].linked, true)
})

test('a comment block above must be contiguous — a blank line breaks the link', () => {
  const found = findParkedTests(`
    // see #1713

    it.todo('should return currentTeam when active organization exists', () => {})
  `)
  assert.equal(found[0].linked, false)
})

test('recognizes test.todo, it.skip, test.skip, and describe.skip', () => {
  const found = findParkedTests(`
    test.todo('a')
    it.skip('b', () => {})
    test.skip('c', () => {})
    describe.skip('d', () => {})
  `)
  assert.equal(found.length, 4)
  assert.deepEqual(found.map(f => f.kind), ['test.todo', 'it.skip', 'test.skip', 'describe.skip'])
})

test('ignores a commented-out call — not a live parked test', () => {
  const found = findParkedTests(`
    // it.todo('old test we deleted')
  `)
  assert.equal(found.length, 0)
})

test('hasIssueRef finds a #NNN ref in the comment line directly above the call', () => {
  const lines = [
    'describe("x", () => {',
    '  const setup = doThing()',
    '  // see #1713',
    "  it.todo('y', () => {})",
  ]
  assert.equal(hasIssueRef(lines, 3), true)
})

test('hasIssueRef stops at the first non-comment line above the call', () => {
  const lines = [
    'describe("x", () => {',
    '  // see #1713',
    '  const setup = doThing()',
    "  it.todo('y', () => {})",
  ]
  assert.equal(hasIssueRef(lines, 3), false)
})

test('formatReport passes cleanly when nothing is found', () => {
  assert.match(formatReport([], 12), /✓ No unlinked parked tests/)
})

test('formatReport lists every violation with file:line and demands a #NNN link', () => {
  const out = formatReport(
    [{ file: 'packages/x/tests/a.test.ts', line: 5, kind: 'it.todo', snippet: "it.todo('x')" }],
    3,
  )
  assert.match(out, /1 parked test\(s\)/)
  assert.match(out, /packages\/x\/tests\/a\.test\.ts:5/)
  assert.match(out, /not tracking/)
})
