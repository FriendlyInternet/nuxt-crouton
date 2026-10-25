/**
 * #2429 — epic-scaffold plan→issues mapping. Pins the five facts a pipeline-ready epic needs:
 * pipeline block, Blocked-by ordering, labels, Packages-approved, branch name — and the dedup refusal.
 *
 *   node --test scripts/epic-scaffold.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseScaffoldPlan, scaffoldActions, epicBranch, slugify, renderTree } from './epic-scaffold.mjs'
import { parsePipelineBlock } from './pipeline-context.mjs'
import { PlanError } from './apply-decompose-plan.mjs'

const PLAN = (over = {}) => ({
  title: 'Ship the thing',
  body: 'Goal.\n\nDedup-checked: searched «thing» → none',
  labels: ['pkg:crouton-core'],
  children: [
    { title: 'A', body: 'first', labels: ['type:feat', 'pkg:crouton-core'] },
    { title: 'B', body: 'second', labels: ['type:feat'], blockedBy: [0] },
  ],
  ...over,
})

test('refuses an epic body without a Dedup-checked line', () => {
  assert.throws(() => parseScaffoldPlan(PLAN({ body: 'no receipt' })), PlanError)
})

test('adds the epic label and derives the slug', () => {
  const p = parseScaffoldPlan(PLAN())
  assert.ok(p.labels.includes('epic'))
  assert.equal(p.slug, 'ship-the-thing')
  assert.equal(epicBranch(2421, p.slug), 'epic/2421-ship-the-thing')
  assert.equal(slugify('  Hello, World!! '), 'hello-world')
})

test('children get the pipeline block at depth 1; blocked child waits with dispatch recorded', () => {
  const p = parseScaffoldPlan(PLAN())
  const acts = scaffoldActions(p, { epic: 2421, knownLabels: ['type:feat', 'pkg:crouton-core'] })
  const creates = acts.filter(a => a.type === 'create')
  assert.equal(creates.length, 2)
  for (const c of creates) {
    const b = parsePipelineBlock(c.body)
    assert.equal(b.epic, 2421)
    assert.equal(b.depth, 1)
    assert.equal(b.epic_branch, 'epic/2421-ship-the-thing')
  }
  assert.equal(parsePipelineBlock(creates[0].body).dispatch, null)
  assert.ok(parsePipelineBlock(creates[1].body).dispatch)
  assert.deepEqual(acts.filter(a => a.type === 'note-blocked').map(a => a.blockedByRefs), [['child0']])
  assert.deepEqual(acts.filter(a => a.type === 'trigger-label').map(a => a.ref), ['child0'])
  assert.equal(acts.filter(a => a.type === 'link').every(a => a.parent === 2421), true)
})

test('packagesApproved is stamped on every child once', () => {
  const p = parseScaffoldPlan(PLAN({ packagesApproved: 'owner, #2108' }))
  for (const c of p.children) assert.equal(c.body.match(/Packages-approved:/g).length, 1)
})

test('unknown labels are dropped, not fatal; cycles fail loud', () => {
  const p = parseScaffoldPlan(PLAN())
  const acts = scaffoldActions(p, { epic: 1, knownLabels: ['type:feat'] })
  assert.deepEqual(acts.find(a => a.ref === 'child0' && a.type === 'create').droppedLabels, ['pkg:crouton-core'])
  assert.throws(() => parseScaffoldPlan(PLAN({ children: [
    { title: 'A', body: 'x', blockedBy: [1] }, { title: 'B', body: 'y', blockedBy: [0] },
  ] })), PlanError)
})

test('renderTree shows branch, blocks and ordering', () => {
  const p = parseScaffoldPlan(PLAN())
  const out = renderTree(p, scaffoldActions(p, { epic: 'N' }))
  assert.match(out, /epic\/N-ship-the-thing/)
  assert.match(out, /Blocked-by: child0/)
  assert.match(out, /<!-- pipeline: epic=N/)
})
