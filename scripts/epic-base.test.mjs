import test from 'node:test'
import assert from 'node:assert/strict'
import { chooseEpicBase } from './epic-base.mjs'

const open = (number, branch = '') => ({ number, state: 'open', branch })
const closed = (number, branch = '') => ({ number, state: 'closed', branch })

test('hand-attached child takes the open parent branch', () => {
  const r = chooseEpicBase({ block: {}, ancestors: [open(3047, 'epic/3047-x')] })
  assert.equal(r.epic_branch, 'epic/3047-x')
  assert.equal(r.source, 'parent')
  assert.equal(r.epic, 3047)
})

test('walks past a parent with no branch to the grandparent', () => {
  const r = chooseEpicBase({ ancestors: [open(2), open(1, 'epic/1-a')] })
  assert.equal(r.epic_branch, 'epic/1-a')
})

test('no ancestors → main', () => {
  const r = chooseEpicBase({})
  assert.equal(r.epic_branch, '')
  assert.equal(r.source, 'none')
})

test('decomposer-made ticket keeps its block branch', () => {
  const r = chooseEpicBase({ block: { epic: 3047, epic_branch: 'epic/3047-x' }, ancestors: [open(3047, 'epic/3047-x')] })
  assert.equal(r.epic_branch, 'epic/3047-x')
  assert.equal(r.source, 'block')
})

test('explicit block branch beats the parent', () => {
  const r = chooseEpicBase({ block: { epic_branch: 'epic/A' }, ancestors: [open(2, 'epic/B')] })
  assert.equal(r.epic_branch, 'epic/A')
})

test('base=main pins main over an open parent', () => {
  const r = chooseEpicBase({ block: { base: 'main' }, ancestors: [open(2, 'epic/B')] })
  assert.equal(r.epic_branch, '')
  assert.equal(r.source, 'block-main')
})

test('closed parent with a leftover branch is skipped', () => {
  assert.equal(chooseEpicBase({ ancestors: [closed(3460, 'epic/3460-x')] }).epic_branch, '')
  assert.equal(chooseEpicBase({ ancestors: [closed(3460, 'epic/3460-x'), open(1, 'epic/1-a')] }).epic_branch, 'epic/1-a')
})

test('parent read failure falls back to the block, and logs the error', () => {
  const a = chooseEpicBase({ block: { epic_branch: 'epic/A' }, readError: 'HTTP 500' })
  assert.equal(a.epic_branch, 'epic/A')
  const b = chooseEpicBase({ readError: 'HTTP 500' })
  assert.equal(b.epic_branch, '')
  assert.equal(b.source, 'parent-read-failed')
  assert.match(b.log, /HTTP 500/)
})

test('block with epic but no branch (#3491 shape) walks up; closed parent → main', () => {
  const r = chooseEpicBase({ block: { epic: 3460 }, ancestors: [closed(3460, 'epic/3460-x')] })
  assert.equal(r.epic_branch, '')
})

// ── walkAncestors: the code that actually follows GitHub's parent links ──
import { walkAncestors } from './epic-base.mjs'

const fakeApi = ({ parents = {}, states = {}, branches = {}, fail = {} }) => (path) => {
  let m = path.match(/issues\/(\d+)\/parent$/)
  if (m) {
    const n = Number(m[1])
    if (fail[n]) throw new Error(fail[n])
    const p = parents[n]
    if (!p) throw new Error('gh: Not Found (HTTP 404)')
    return { number: p, state: states[p] || 'open' }
  }
  m = path.match(/heads\/epic\/(\d+)-$/)
  if (m) return branches[m[1]] ? [{ ref: `refs/heads/${branches[m[1]]}` }] : []
  throw new Error('unexpected ' + path)
}

test('walker: skips a branchless parent and reaches the grandparent', () => {
  const api = fakeApi({ parents: { 10: 2, 2: 1 }, branches: { 1: 'epic/1-a' } })
  const w = walkAncestors(10, 'o/r', api)
  assert.equal(w.readError, '')
  assert.equal(chooseEpicBase({ ancestors: w.ancestors }).epic_branch, 'epic/1-a')
})

test('walker: closed parent is skipped to the grandparent', () => {
  const api = fakeApi({ parents: { 10: 2, 2: 1 }, states: { 2: 'closed' }, branches: { 2: 'epic/2-x', 1: 'epic/1-a' } })
  const w = walkAncestors(10, 'o/r', api)
  assert.equal(chooseEpicBase({ ancestors: w.ancestors }).epic_branch, 'epic/1-a')
})

test('walker: 404 means top of tree → main, no error', () => {
  const w = walkAncestors(10, 'o/r', fakeApi({}))
  assert.equal(w.readError, '')
  assert.deepEqual(w.ancestors, [])
})

test('walker: other read error is reported and falls back to main', () => {
  const w = walkAncestors(10, 'o/r', fakeApi({ fail: { 10: 'HTTP 500' } }))
  assert.match(w.readError, /500/)
  const r = chooseEpicBase({ ancestors: w.ancestors, readError: w.readError })
  assert.equal(r.source, 'parent-read-failed')
})

test('walker: empty repo is a read error, not a silent "top of tree"', () => {
  assert.match(walkAncestors(10, '', fakeApi({})).readError, /repo/)
})

test('walker: stops at the 5-level depth cap', () => {
  const parents = {}
  for (let i = 100; i < 120; i++) parents[i] = i + 1
  const w = walkAncestors(100, 'o/r', fakeApi({ parents }))
  assert.equal(w.ancestors.length, 5)
})
