/**
 * #1696 redesign contract — pi PLANS, code APPLIES.
 *
 * The case that minted it: on the #1706 live run pi built `gh issue create` with a
 * `$(cat <<'EOF' … )` body, bash choked (`unexpected EOF … )`, exit 2), zero issues were created,
 * and pi fabricated success. This module removes both failure modes: pi only writes a plan; code
 * applies it via execFile array-args (no shell) and creates the issues (nothing to fabricate).
 * These tests pin the pure core + the create→link→label sequence (with a mock executor).
 *
 *   node --test scripts/apply-decompose-plan.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  parsePlan, PlanError, sanitizeLabels, buildChildBody, planToActions, runActions,
} from './apply-decompose-plan.mjs'
import { parsePipelineBlock } from './pipeline-context.mjs'
import { WORKER_TRIGGER, MAX_DEPTH } from './pipeline-loop-guard.mjs'

const BRANCH = 'epic/1706-pipeline-e2e'
const CHILD = (over = {}) => ({ title: 'Add slugify', body: '## 👤 For humans\nA helper.', labels: ['type:chore', 'meta:agents'], needsSplit: false, ...over })

// ── parsePlan ──────────────────────────────────────────────────────────────────
test('parsePlan accepts a leaf plan', () => {
  assert.deepEqual(parsePlan({ leaf: true }), { leaf: true, children: [] })
  assert.deepEqual(parsePlan('{"leaf":true}'), { leaf: true, children: [] })
})

test('parsePlan accepts a split plan and normalizes children', () => {
  const p = parsePlan({ leaf: false, children: [CHILD(), CHILD({ title: 'Add wordCount', needsSplit: true })] })
  assert.equal(p.children.length, 2)
  assert.equal(p.children[1].needsSplit, true)
})

test('parsePlan rejects malformed plans (honest failure, no fabrication)', () => {
  assert.throws(() => parsePlan('not json'), PlanError)
  assert.throws(() => parsePlan({}), PlanError)                         // no leaf boolean
  assert.throws(() => parsePlan({ leaf: false }), PlanError)            // no children
  assert.throws(() => parsePlan({ leaf: false, children: [] }), PlanError)
  assert.throws(() => parsePlan({ leaf: false, children: [{ title: '', body: 'x' }] }), PlanError)
  assert.throws(() => parsePlan({ leaf: false, children: [{ title: 'x', body: '' }] }), PlanError)
})

// ── signoff (Option C, #1821): a design sign-off hold instead of deadlocking design-worker children ──
test('parsePlan accepts a signoff hold and normalizes it', () => {
  const p = parsePlan({ signoff: { summary: 'schema + UI are ambiguous', questions: ['equal vs weighted?', '  ', 'matrix vs list?'] } })
  assert.ok(p.signoff)
  assert.equal(p.signoff.questions.length, 2)               // blank question dropped
  assert.equal(p.signoff.schema, null)
  assert.equal(p.signoff.diagram, null)
  assert.equal(p.signoff.ui, null)
})

test('parsePlan keeps optional signoff artifacts when well-formed', () => {
  const p = parsePlan({ signoff: { summary: 's', questions: ['q'], schema: { collection: 'expenses', fields: { amount: { type: 'number' } } }, ui: '<div>x</div>' } })
  assert.equal(p.signoff.schema.collection, 'expenses')
  assert.deepEqual(p.signoff.schema.fields, { amount: { type: 'number' } })
  assert.equal(p.signoff.ui, '<div>x</div>')
})

test('parsePlan rejects a malformed signoff (honest failure)', () => {
  assert.throws(() => parsePlan({ signoff: { questions: ['q'] } }), PlanError)          // no summary
  assert.throws(() => parsePlan({ signoff: { summary: 's' } }), PlanError)              // no questions
  assert.throws(() => parsePlan({ signoff: { summary: 's', questions: [] } }), PlanError)
  assert.throws(() => parsePlan({ signoff: { summary: 's', questions: ['  '] } }), PlanError)
})

test('a signoff plan → one signoff-hold action on the target, no children', () => {
  const acts = planToActions(parsePlan({ signoff: { summary: 's', questions: ['q1', 'q2'] } }), CTX)
  assert.deepEqual(acts.map(a => a.type), ['signoff-hold'])
  assert.equal(acts[0].issue, CTX.target)
  assert.equal(acts[0].signoff.questions.length, 2)
  assert.ok(!acts.some(a => a.type === 'create'))            // NEVER spawns worker children
})

test('parsePlan enforces MAX_CHILDREN', () => {
  const many = { leaf: false, children: Array.from({ length: 7 }, (_, i) => CHILD({ title: `c${i}` })) }
  assert.throws(() => parsePlan(many), PlanError)
})

// ── sanitizeLabels ──────────────────────────────────────────────────────────────
test('sanitizeLabels keeps known and drops unknown (the bad-label create failure)', () => {
  const { kept, dropped } = sanitizeLabels(['type:chore', 'nonexistent', 'meta:agents'], ['type:chore', 'meta:agents'])
  assert.deepEqual(kept, ['type:chore', 'meta:agents'])
  assert.deepEqual(dropped, ['nonexistent'])
})

// ── buildChildBody ───────────────────────────────────────────────────────────────
test('buildChildBody injects the WS2 block at childDepth', () => {
  const body = buildChildBody('## body', { epic: 1685, childDepth: 2, epic_branch: BRANCH })
  assert.deepEqual(parsePipelineBlock(body), { epic: 1685, depth: 2, epic_branch: BRANCH })
  assert.match(body, /^## body/)
})

// ── planToActions ────────────────────────────────────────────────────────────────
const CTX = { target: 1706, epic: 1706, depth: 0, epic_branch: BRANCH, knownLabels: ['type:chore', 'meta:agents'] }

test('a leaf plan → edit-body(target) + label target work-this', () => {
  const acts = planToActions({ leaf: true, children: [] }, CTX)
  assert.deepEqual(acts.map(a => a.type), ['edit-body', 'add-label'])
  assert.equal(acts[1].label, WORKER_TRIGGER)
  assert.equal(acts[1].issue, 1706)
})

test('a split plan → create+link+trigger-label per child, block at depth+1', () => {
  const acts = planToActions({ leaf: false, children: [CHILD(), CHILD({ title: 'B', needsSplit: true })] }, CTX)
  const creates = acts.filter(a => a.type === 'create')
  assert.equal(creates.length, 2)
  // child body carries depth = target depth (0) + 1 = 1
  assert.equal(parsePipelineBlock(creates[0].body).depth, 1)
  // leaf child → work-this; needsSplit child → delegate-pi
  const triggers = acts.filter(a => a.type === 'trigger-label').map(a => a.label)
  assert.deepEqual(triggers, ['work-this', 'delegate-pi'])
})

test('depth cap forces work-this even for a needsSplit child at MAX_DEPTH', () => {
  const acts = planToActions({ leaf: false, children: [CHILD({ needsSplit: true })] }, { ...CTX, depth: MAX_DEPTH - 1 })
  // childDepth = MAX_DEPTH → labelForChild forces work-this
  assert.equal(acts.find(a => a.type === 'trigger-label').label, 'work-this')
})

test('unknown labels are dropped, not passed to create', () => {
  const acts = planToActions({ leaf: false, children: [CHILD({ labels: ['type:chore', 'bogus'] })] }, CTX)
  const create = acts.find(a => a.type === 'create')
  assert.deepEqual(create.labels, ['type:chore'])
  assert.deepEqual(create.droppedLabels, ['bogus'])
})

// ── runActions with a MOCK executor — the real create→link→label sequence, no network ──
test('runActions creates, links, and labels each child in order (mock exec)', () => {
  const calls = []
  let next = 5000
  const exec = (file, args) => {
    calls.push([file, ...args])
    if (args[0] === 'issue' && args[1] === 'create') return `https://github.com/o/r/issues/${++next}`
    if (args[0] === 'api' && String(args[1]).endsWith(String(next))) return String(90000 + next) // REST id
    return ''
  }
  const acts = planToActions({ leaf: false, children: [CHILD(), CHILD({ title: 'B' })] }, CTX)
  const summary = runActions(acts, { repo: 'o/r', exec, log: () => {}, writeBody: (t, b) => `/tmp/${t}` })
  assert.equal(summary.created.length, 2)
  assert.equal(summary.created[0].number, 5001)
  // sequence for child 0: create → api(get id) → api(POST sub_issues) → issue edit --add-label
  const kinds = calls.map(c => `${c[1]} ${c[2] || ''}`.trim())
  assert.ok(kinds.includes('issue create'))
  assert.ok(kinds.some(k => k.startsWith('api --method')))       // the link POST
  assert.ok(kinds.includes('issue edit'))                        // the trigger label
  // NO call ever goes through a shell — args are arrays. Assert no arg contains a heredoc/`$(`.
  assert.ok(!calls.flat().some(a => typeof a === 'string' && a.includes('$(')))
})

test('runActions on a signoff hold comments the forks + blocks the epic, never creates children (mock exec)', () => {
  const calls = []
  let commentBody = ''
  // Stub: node render scripts + gh all go through here; capture the comment body via writeBody.
  const exec = (file, args) => { calls.push([file, ...args]); return '' }
  const acts = planToActions(parsePlan({ signoff: { summary: 'schema + view ambiguous', questions: ['equal vs weighted?', 'matrix vs list?'] } }),
    { ...CTX, epic_branch: BRANCH })
  const summary = runActions(acts, { repo: 'o/r', exec, log: () => {}, writeBody: (t, b) => { commentBody = b; return `/tmp/${t}` } })
  // held, not created
  assert.equal(summary.held.length, 1)
  assert.equal(summary.created.length, 0)
  // posted a comment on the target epic + added status:blocked
  const kinds = calls.map(c => c.slice(1, 4).join(' '))
  assert.ok(kinds.some(k => k.startsWith('issue comment 1706')), 'comments on the epic')
  assert.ok(calls.some(c => c.includes('--add-label') && c.includes('status:blocked')), 'adds status:blocked')
  // NEVER creates a worker child for a design decision
  assert.ok(!kinds.some(k => k.startsWith('issue create')), 'no children created')
  // the comment carries the forks + the hold instruction
  assert.match(commentBody, /equal vs weighted\?/)
  assert.match(commentBody, /matrix vs list\?/)
  assert.match(commentBody, /lgtm/i)
})

test('runActions on a leaf edits the target body and labels it (mock exec)', () => {
  const calls = []
  const exec = (file, args) => { calls.push(args); return args.includes('.body') ? 'existing body' : '' }
  const acts = planToActions({ leaf: true, children: [] }, CTX)
  runActions(acts, { repo: 'o/r', exec, writeBody: (t, b) => { calls.push(['BODY', b]); return `/tmp/${t}` } })
  // the written body must contain the pipeline block merged onto the existing prose
  const written = calls.find(c => c[0] === 'BODY')[1]
  assert.match(written, /existing body/)
  assert.match(written, /<!-- pipeline: epic=1706 depth=0 epic_branch=/)
  // #1764: work-this is applied as remove-then-add so a stale label still fires a fresh event
  const labelCalls = calls.filter(c => Array.isArray(c) && c.includes('work-this'))
  assert.ok(labelCalls.some(c => c.includes('--remove-label')), 'must remove work-this first')
  assert.ok(labelCalls.some(c => c.includes('--add-label')), 'then re-add work-this')
})
