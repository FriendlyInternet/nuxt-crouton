// layer: stack
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
  body: 'Goal.\n\n## 🧪 How to test\n1. Open the app\n2. Check the thing\n\nDedup-checked: searched «thing» → none',
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

test('refuses an epic body without a How to test section', () => {
  assert.throws(
    () => parseScaffoldPlan(PLAN({ body: 'Goal.\n\nDedup-checked: searched «x» → none' })),
    e => e instanceof PlanError && /How to test/.test(e.message),
  )
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
  // #2776: the plan is reviewed first, so BOTH children wait and record what they will be released with.
  assert.ok(parsePipelineBlock(creates[0].body).dispatch)
  assert.ok(parsePipelineBlock(creates[1].body).dispatch)
  assert.deepEqual(acts.filter(a => a.type === 'note-blocked').map(a => a.blockedByRefs), [['child0']])
  assert.deepEqual(acts.filter(a => a.type === 'trigger-label').map(a => a.ref), [])
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

test('scaffoldActions ends by requesting the ticket review, with no trigger-label yet (#2776)', () => {
  const acts = scaffoldActions(parseScaffoldPlan(PLAN()), { epic: 2421, knownLabels: ['type:feat'] })
  assert.equal(acts.some(a => a.type === 'trigger-label'), false)
  assert.deepEqual(acts.at(-1), { type: 'request-ticket-review', epic: 2421 })
})

test('a docs-only epic skips the review: one trigger-label per unblocked child', () => {
  const p = parseScaffoldPlan(PLAN())
  p.children.forEach(c => { c.labels = ['type:docs'] })
  const acts = scaffoldActions(p, { epic: 2421, knownLabels: ['type:docs'] })
  assert.deepEqual(acts.slice(acts.findIndex(a => a.type === 'trigger-label')).map(a => [a.type, a.ref]), [['trigger-label', 'child0']])
  assert.equal(acts.some(a => a.type === 'request-ticket-review'), false)
})

test('resolveMainSha reads main from the remote, not a local origin/main ref (#2708)', async () => {
  const { resolveMainSha, unknownPlanLabels } = await import('./epic-scaffold.mjs')
  const sha = 'a'.repeat(40)
  assert.equal(resolveMainSha(() => `${sha}\trefs/heads/main`), sha)
  assert.throws(() => resolveMainSha(() => ''), /cannot resolve origin main/)
  assert.deepEqual(unknownPlanLabels({ labels: ['epic', 'nope'], children: [] }, ['epic']), ['nope'])
  assert.deepEqual(unknownPlanLabels({ labels: ['x'], children: [] }, []), [])
})

test('packagesApproved {why, packages} labels every child with one pkg:* per package (#2778)', () => {
  const p = parseScaffoldPlan(PLAN({ packagesApproved: { why: 'owner, #227', packages: ['crouton-bookings', 'pkg:crouton-sales', 'crouton-assets'] } }))
  for (const c of p.children) {
    for (const l of ['pkg:crouton-bookings', 'pkg:crouton-sales', 'pkg:crouton-assets']) assert.ok(c.labels.includes(l), `${c.title} missing ${l}`)
    assert.equal(c.body.match(/Packages-approved: owner, #227/g).length, 1)
  }
  assert.equal(p.children[0].labels.filter(l => l === 'pkg:crouton-core').length, 1)
})

test('packagesApproved object without packages is refused', () => {
  assert.throws(() => parseScaffoldPlan(PLAN({ packagesApproved: { why: 'x', packages: [] } })), PlanError)
})
