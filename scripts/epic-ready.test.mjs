// The pure epic→main-ready predicate (#1815). A false SKIP is safe; a false OPEN spams main — so
// these pin the conservative rule: open only when children exist, ALL closed, branch ahead, no PR.
//   node --test scripts/epic-ready.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseEpicNumber, decideOpen } from './epic-ready.mjs'

test('parseEpicNumber pulls the number from an epic branch, else null', () => {
  assert.equal(parseEpicNumber('epic/1701-cold-scaffold-first-run'), 1701)
  assert.equal(parseEpicNumber('epic/42-x'), 42)
  assert.equal(parseEpicNumber('work-1741'), null)
  assert.equal(parseEpicNumber('main'), null)
  assert.equal(parseEpicNumber(''), null)
  assert.equal(parseEpicNumber(undefined), null)
})

const CLOSED = { state: 'closed' }
const OPEN = { state: 'open' }

test('opens when all children closed, branch ahead, no existing PR', () => {
  const d = decideOpen({ subIssues: [CLOSED, CLOSED], existingEpicMainPrs: [], aheadCount: 3 })
  assert.equal(d.open, true)
})

test('does NOT open while any child is still open', () => {
  const d = decideOpen({ subIssues: [CLOSED, OPEN], existingEpicMainPrs: [], aheadCount: 3 })
  assert.equal(d.open, false)
  assert.match(d.reason, /1 child/)
})

test('does NOT open when an epic→main PR already exists (idempotent, no dup)', () => {
  const d = decideOpen({ subIssues: [CLOSED], existingEpicMainPrs: [{ number: 9 }], aheadCount: 3 })
  assert.equal(d.open, false)
  assert.match(d.reason, /already open/)
})

test('does NOT open an epic with no sub-issues', () => {
  const d = decideOpen({ subIssues: [], existingEpicMainPrs: [], aheadCount: 3 })
  assert.equal(d.open, false)
  assert.match(d.reason, /no sub-issues/)
})

test('does NOT open when the branch is not ahead of main (nothing to land)', () => {
  const d = decideOpen({ subIssues: [CLOSED], existingEpicMainPrs: [], aheadCount: 0 })
  assert.equal(d.open, false)
  assert.match(d.reason, /ahead of main/)
})

test('defaults are safe — empty call never opens', () => {
  assert.equal(decideOpen().open, false)
})
