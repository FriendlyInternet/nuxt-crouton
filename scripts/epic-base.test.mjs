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
