import { test } from 'node:test'
import assert from 'node:assert/strict'
import { decideLeafMerge, skipBeforeReads, applySharedCodeHold, decideReview, decideV1, mergeDecisionCheck, withoutMergeDecision, shouldEnableAuto, canMergeNow } from './pr-merge-gate.mjs'
import { ownerMergeGo } from './owner-merge-go.mjs'

const owner = 'pmcp'
const c = (body, at) => ({ user: { login: owner, type: 'User' }, body, created_at: at })
const k = (date) => ({ parents: [{}], commit: { committer: { date } }, files: ['a.ts'] })
const goFor = (comments, commits = []) => ownerMergeGo({ owner, comments, commits })
const okGo = { go: true }
// A work-* → main PR with everything green; override one fact per case.
const leaf = (o = {}) => decideLeafMerge({
  baseRef: 'main', headRef: 'work-1', labels: [], go: okGo, red: false, ciGate: 'success', mergeableState: 'clean', ...o,
})

test('1. no owner ok + everything green → no merge, even with build:approved (the key safety case)', () => {
  assert.equal(leaf({ go: { go: false } }).merge, false)
  assert.equal(leaf({ go: { go: false }, labels: ['build:approved'] }).merge, false)
})
test('2. owner ok, CI Gate success, not red, clean, no label → merge', () => {
  assert.equal(leaf().merge, true)
})
test('3. owner ok but a check is red → no merge', () => {
  const r = leaf({ red: true })
  assert.equal(r.merge, false)
  assert.equal(r.code, 'red')
})
test('4. owner ok but CI Gate not success → no merge', () => {
  for (const ciGate of ['pending', 'missing', 'failure']) assert.equal(leaf({ ciGate }).merge, false)
})
test('5. owner ok but blocked/dirty → no merge, reason names it', () => {
  for (const mergeableState of ['blocked', 'dirty']) {
    const r = leaf({ mergeableState })
    assert.equal(r.merge, false)
    assert.match(r.reason, new RegExp(mergeableState))
  }
})
test('6. epic-based PR needs build:approved, even with go', () => {
  const e = (labels) => decideLeafMerge({ baseRef: 'epic/1-x', headRef: 'work-1', labels, go: okGo, headReview: { kind: 'other' }, red: false, ciGate: 'success', mergeableState: 'clean' })
  assert.equal(e([]).merge, false)
  assert.equal(e(['build:approved']).merge, true)
})
test('7. non-work-* head into main is declined; epic → main is decided elsewhere (#3105)', () => {
  assert.equal(leaf({ headRef: 'feature/x' }).merge, false)
  for (const labels of [[], ['build:approved']]) for (const go of [true, false]) {
    const d = decideLeafMerge({ baseRef: 'main', headRef: 'epic/1-x', labels, go: { go }, ciGate: 'success', mergeableState: 'clean' })
    assert.equal(d.merge, false)
    assert.equal(d.code, 'ineligible')
  }
})

// Ordering lives in ownerMergeGo, fed real comment/commit fixtures.
test('ok then green and green then ok give the same go → merge', () => {
  const go = goFor([c('ok', '2026-10-28T16:00:00Z')], [k('2026-10-28T15:00:00Z')])
  assert.equal(go.go, true)
  assert.equal(leaf({ go }).merge, true)
})
test('ok then a later worker comment → no merge', () => {
  assert.equal(leaf({ go: goFor([c('ok', '2026-10-28T16:00:00Z'), c('**Worker:** pushed a fix', '2026-10-28T16:05:00Z')]) }).merge, false)
})
test('ok then a later non-merge commit → no merge', () => {
  assert.equal(leaf({ go: goFor([c('ok', '2026-10-28T16:00:00Z')], [k('2026-10-28T17:00:00Z')]) }).merge, false)
})
test('ok, then an owner **Worker:** comment, then the worker commit → no merge until a fresh ok', () => {
  const comments = [c('ok', '2026-10-28T16:00:00Z'), c('**Worker:** adding a case', '2026-10-28T16:05:00Z')]
  const commits = [k('2026-10-28T16:10:00Z')]
  assert.equal(leaf({ go: goFor(comments, commits) }).merge, false)
  const fresh = [...comments, c('ok', '2026-10-28T16:20:00Z')]
  assert.equal(leaf({ go: goFor(fresh, commits) }).merge, true)
})

// ---- #3173: the owner's ok after a twice-rejected build merges a work-* → epic/* PR ----
import { reviewState } from './build-review-state.mjs'
const bots = ['app[bot]']
const rv = (sha, at, final = true) => ({ user: { login: 'app[bot]', type: 'Bot' }, created_at: at,
  body: `<!-- build-review-sha:${sha} -->\n${final ? '<!-- build-review-final -->\n' : ''}<!-- build-review-verdict:no-go -->\n\n${final ? '🔴 **Build rejected twice**' : '🔴 **Build sent back**'}\n` })
const epicLeaf = (comments, headSha, o = {}, commits = []) => {
  const go = goFor(comments, commits)
  const st = reviewState({ comments, headSha, bots })
  return decideLeafMerge({ baseRef: 'epic/1-x', headRef: 'work-2', labels: [], go, ownerHold: ['final', 'needs-owner'].includes(st.kind) ? st : null, red: false, ciGate: 'success', mergeableState: 'clean', ...o })
}
test('3173: final hold, then owner ok, green → merge', () => {
  const d = epicLeaf([rv('aaa', '2026-11-01T10:00:00Z'), c('ok', '2026-11-01T11:00:00Z')], 'aaa')
  assert.equal(d.merge, true)
})
test('3173: owner ok while a check is red → no merge', () => {
  const d = epicLeaf([rv('aaa', '2026-11-01T10:00:00Z'), c('ok', '2026-11-01T11:00:00Z')], 'aaa', { red: true })
  assert.equal(d.merge, false)
  assert.equal(d.code, 'red')
})
test('3173: not ok, push, green, no verdict yet → no merge; fresh hold + ok → merge', () => {
  const cs = [rv('aaa', '2026-11-01T10:00:00Z'), c('not ok: change it', '2026-11-01T11:00:00Z')]
  assert.equal(epicLeaf(cs, 'bbb').merge, false)
  const cs2 = [...cs, rv('bbb', '2026-11-01T13:00:00Z'), c('ok', '2026-11-01T14:00:00Z')]
  assert.equal(epicLeaf(cs2, 'bbb').merge, true)
})
test('3173: ok BEFORE the final hold → no merge', () => {
  const d = epicLeaf([c('ok', '2026-11-01T09:00:00Z'), rv('aaa', '2026-11-01T10:00:00Z')], 'aaa')
  assert.equal(d.merge, false)
  assert.equal(d.code, 'no-review')
})
test('3173: round-1 (not final) + ok → no merge', () => {
  assert.equal(epicLeaf([rv('aaa', '2026-11-01T10:00:00Z', false), c('ok', '2026-11-01T11:00:00Z')], 'aaa').merge, false)
})
test('3173: work-* → main with owner ok, no verdict, no label → unchanged (merges)', () => {
  assert.equal(leaf().merge, true)
  assert.equal(decideLeafMerge({ baseRef: 'main', headRef: 'work-1', labels: [], go: { go: false }, ownerHold: { at: '2026-11-01T10:00:00Z' }, red: false, ciGate: 'success', mergeableState: 'clean' }).merge, false)
})
test('3173: final hold, owner ok, then a later non-merge commit → no merge (epic path)', () => {
  const cs = [rv('aaa', '2026-11-01T10:00:00Z'), c('ok', '2026-11-01T11:00:00Z')]
  assert.equal(epicLeaf(cs, 'aaa', {}, []).merge, true)
  assert.equal(epicLeaf(cs, 'aaa', {}, [k('2026-11-01T12:00:00Z')]).merge, false)
})

// ---- #3428: the owner's ok after a needs-owner verdict merges ----
const needsOwner = (sha, at) => ({ user: { login: 'app[bot]', type: 'Bot' }, created_at: at,
  body: `<!-- build-review-sha:${sha} -->\n<!-- build-review-verdict:needs-owner -->\n\n🔀 **Needs your call**\n` })
test('3428: needs-owner verdict, then owner ok, green → merge', () => {
  const d = epicLeaf([needsOwner('aaa', '2026-11-01T10:00:00Z'), c('ok', '2026-11-01T11:00:00Z')], 'aaa')
  assert.equal(d.merge, true)
  assert.equal(d.reason, 'owner ok after needs-owner')
})
test('3428: ok BEFORE the needs-owner verdict → no merge', () => {
  const d = epicLeaf([c('ok', '2026-11-01T09:00:00Z'), needsOwner('aaa', '2026-11-01T10:00:00Z')], 'aaa')
  assert.equal(d.merge, false)
  assert.equal(d.code, 'no-review')
})
test('3428: needs-owner on an older SHA, head moved → no merge', () => {
  const d = epicLeaf([needsOwner('aaa', '2026-11-01T10:00:00Z'), c('ok', '2026-11-01T11:00:00Z')], 'bbb')
  assert.equal(d.merge, false)
})
test('3428: needs-owner + ok but a check is red → no merge', () => {
  const d = epicLeaf([needsOwner('aaa', '2026-11-01T10:00:00Z'), c('ok', '2026-11-01T11:00:00Z')], 'aaa', { red: true })
  assert.equal(d.code, 'red')
})
test('3428: go verdict, no build:approved label, owner ok → no merge', () => {
  const goReview = { user: { login: 'app[bot]', type: 'Bot' }, created_at: '2026-11-01T10:00:00Z',
    body: '<!-- build-review-sha:aaa -->\n<!-- build-review-verdict:go -->\n\n✅ **Build looks good**\n' }
  const d = epicLeaf([goReview, c('ok', '2026-11-01T11:00:00Z')], 'aaa')
  assert.equal(d.merge, false)
})

// #3467 — a merge commit after the owner's ok keeps the ok but waits for a build review of the new head.
// The API can't tell a clean merge from a conflict-resolving one, so both wait: the cost is one automatic review.
const km = (date) => ({ parents: [{}, {}], commit: { committer: { date } }, files: ['a.ts'] })
const SHA = '04bfeaa0aaaaaaaa'
const mergedGo = () => goFor([c('ok', '2026-11-06T09:51:19Z')], [k('2026-11-06T09:12:00Z'), km('2026-11-06T11:13:00Z')])

test('#3467 merge commit after ok, head unreviewed → head-unreviewed naming the SHA', () => {
  const go = mergedGo()
  assert.equal(go.go, true)
  assert.equal(go.mergeSince, true)
  const r = leaf({ go, headSha: SHA, headReview: { kind: 'pending' } })
  assert.equal(r.merge, false)
  assert.equal(r.code, 'head-unreviewed')
  assert.match(r.reason, /04bfeaa0/)
})
test('#3467 same, after a go on the new head → merge with no fresh ok', () => {
  assert.equal(leaf({ go: mergedGo(), headSha: SHA, headReview: { kind: 'other' } }).merge, true)
})
test('#3467 no-go on the merged head → no merge', () => {
  const r = leaf({ go: mergedGo(), headSha: SHA, headReview: { kind: 'round1' } })
  assert.equal(r.merge, false)
  assert.equal(r.code, 'head-unreviewed')
})
test('#3467 owner ok after a final hold on the merged head → merge', () => {
  const go = { go: true, mergeSince: true, approvedAt: '2026-11-06T12:00:00Z' }
  assert.equal(leaf({ go, headSha: SHA, headReview: { kind: 'final' }, ownerHold: { kind: 'final', at: '2026-11-06T11:30:00Z' } }).merge, true)
})
test('#3467 ok given after the merge commit → merge without a review', () => {
  const go = goFor([c('ok', '2026-11-06T12:00:00Z')], [km('2026-11-06T11:13:00Z')])
  assert.equal(go.mergeSince, false)
  assert.equal(leaf({ go, headSha: SHA }).merge, true)
})
test('#3467 epic base: build:approved needs the head reviewed go', () => {
  const e = (headReview) => decideLeafMerge({ baseRef: 'epic/1-x', headRef: 'work-1', labels: ['build:approved'], go: okGo, headSha: SHA, headReview, red: false, ciGate: 'success', mergeableState: 'clean' })
  assert.equal(e({ kind: 'pending' }).merge, false)
  assert.equal(e({ kind: 'pending' }).code, 'head-unreviewed')
  assert.equal(e({ kind: 'other' }).merge, true)
})

test('first-run A. owner ok + first-run red → merge, reason names it', () => {
  const r = leaf({ firstRun: ['pr-comment'] })
  assert.equal(r.merge, true)
  assert.match(r.reason, /first-run check pr-comment ignored after owner ok/)
})
test('first-run B. no owner ok → held, even for build:approved on an epic base', () => {
  const r = leaf({ firstRun: ['pr-comment'], go: { go: false } })
  assert.equal(r.merge, false)
  assert.equal(r.code, 'first-run-no-ok')
  const e = leaf({ baseRef: 'epic/1-x', headRef: 'work-1', labels: ['build:approved'], firstRun: ['automerge'], go: { go: false } })
  assert.equal(e.merge, false)
})
test('first-run C. a real red still wins over first-run', () => {
  assert.equal(leaf({ red: true, firstRun: ['pr-comment'] }).code, 'red')
})

// ---- #3491: skipBeforeReads / applySharedCodeHold / mergeDecisionCheck ----
const pre = (o = {}) => skipBeforeReads({ draft: false, authorIsPipeline: true, baseRef: 'epic/1-x', headRef: 'work-1', ...o })
test('D3 #2051/#2054: draft sign-off PR → skip draft', () => {
  assert.deepEqual(pre({ draft: true }), { skip: true, code: 'draft' })
  assert.equal(pre({ draft: true, authorIsPipeline: false }).code, 'draft')
})
test('D4 #3423: owner-authored PR → skip not-pipeline', () => {
  assert.deepEqual(pre({ authorIsPipeline: false }), { skip: true, code: 'not-pipeline' })
  assert.equal(pre({ authorIsPipeline: undefined }).code, 'not-pipeline')
})
test('D3/D4 epic → main: the same two skips', () => {
  const o = { baseRef: 'main', headRef: 'epic/1-x' }
  assert.equal(pre({ ...o, draft: true }).code, 'draft')
  assert.equal(pre({ ...o, authorIsPipeline: false }).code, 'not-pipeline')
})
test('D3/D4 work-* → main: the same two skips', () => {
  const o = { baseRef: 'main', headRef: 'work-1' }
  assert.equal(pre({ ...o, draft: true }).code, 'draft')
  assert.equal(pre({ ...o, authorIsPipeline: false }).code, 'not-pipeline')
})
test('not-epic-base: a base that is not epic/*, and not a main leaf/epic PR, → skip not-epic-base', () => {
  assert.equal(pre({ baseRef: 'main', headRef: 'feature/x' }).code, 'not-epic-base')
  assert.equal(pre({ baseRef: 'release/1', headRef: 'work-1' }).code, 'not-epic-base')
})
test('pipeline PRs of each kind → { skip: false }', () => {
  assert.deepEqual(pre(), { skip: false })
  assert.deepEqual(pre({ baseRef: 'main', headRef: 'work-1' }), { skip: false })
  assert.deepEqual(pre({ baseRef: 'main', headRef: 'epic/1-x' }), { skip: false })
})
const mergeGate = { merge: true, code: 'merge', reason: 'reviewed' }
const sh = (o = {}) => applySharedCodeHold(mergeGate, { baseRef: 'epic/1-x', labels: [], files: ['packages/a/x.ts', 'scripts/b.mjs'], go: { go: false }, ...o })
test('D1 #339/#350: packages/ file, no build:approved, no owner ok → shared-code with the file in held', () => {
  const r = sh()
  assert.equal(r.merge, false)
  assert.equal(r.code, 'shared-code')
  assert.deepEqual(r.held, ['packages/a/x.ts'])
  assert.equal(r.hasPkgs, true)
  assert.equal(r.hasWf, false)
})
test('D1 #2777: packages/ with build:approved → gate unchanged', () => {
  assert.equal(sh({ labels: ['build:approved'] }), mergeGate)
})
test('D2 #2442: .github/workflows/ with build:approved, no owner ok → shared-code', () => {
  const r = sh({ labels: ['build:approved'], files: ['.github/workflows/a.yml'] })
  assert.equal(r.code, 'shared-code')
  assert.equal(r.hasWf, true)
})
test('owner ok: any shared-code file with go.go → gate unchanged', () => {
  assert.equal(sh({ go: { go: true } }), mergeGate)
  assert.equal(sh({ go: { go: true }, files: ['.github/workflows/a.yml'], labels: ['build:approved'] }), mergeGate)
})
test('a hold gate passes through, and a main base never holds', () => {
  const g = { merge: false, code: 'no-review' }
  assert.equal(sh({}, g) && applySharedCodeHold(g, { baseRef: 'epic/1-x', files: ['packages/a/x.ts'] }), g)
  assert.equal(sh({ baseRef: 'main' }), mergeGate)
})

test('mergeDecisionCheck: approved → completed/success/approved', () => {
  const r = mergeDecisionCheck({ merge: true, code: 'merge', reason: 'reviewed' })
  assert.equal(r.status, 'completed')
  assert.equal(r.conclusion, 'success')
  assert.equal(r.output.title, 'approved')
})
test('mergeDecisionCheck: every wait → in_progress, no conclusion', () => {
  for (const code of ['no-review', 'head-unreviewed', 'shared-code', 'need-files', 'draft', 'not-v1-base']) {
    const r = mergeDecisionCheck({ merge: false, code, reason: 'why' })
    assert.equal(r.status, 'in_progress')
    assert.equal('conclusion' in r, false)
    assert.equal(r.output.title, `waiting: ${code}`)
    assert.equal(r.output.summary, 'why')
  }
  assert.equal(mergeDecisionCheck(undefined).output.title, 'waiting: unknown')
})

test('decideReview equals decideLeafMerge where preflight passes and firstRun is empty', () => {
  const gos = [{ go: false }, okGo, mergedGo(), { go: true, mergeSince: true, approvedAt: '2026-11-06T12:00:00Z' }]
  const holds = [null, { kind: 'final', at: '2026-11-06T11:30:00Z' }, { kind: 'needs-owner', at: '2026-11-06T11:30:00Z' }]
  let n = 0
  for (const baseRef of ['main', 'epic/1-x']) for (const labels of [[], ['build:approved']]) for (const go of gos)
    for (const kind of ['pending', 'other', 'round1', 'final']) for (const ownerHold of holds) {
      const x = { baseRef, labels, go, ownerHold, headSha: SHA, headReview: { kind } }
      assert.deepEqual(decideReview(x), decideLeafMerge({ ...x, headRef: 'work-1', red: false, ciGate: 'success', mergeableState: 'clean' }))
      n++
    }
  assert.equal(n, 192)
})
test('decideReview equals decideLeafMerge on the #3173/#3428 comment fixtures via reviewState', () => {
  const fixtures = [
    [[rv('aaa', '2026-11-01T10:00:00Z'), c('ok', '2026-11-01T11:00:00Z')], 'aaa'],
    [[rv('aaa', '2026-11-01T10:00:00Z'), c('ok', '2026-11-01T11:00:00Z')], 'bbb'],
    [[needsOwner('aaa', '2026-11-01T10:00:00Z'), c('ok', '2026-11-01T11:00:00Z')], 'aaa'],
    [[needsOwner('aaa', '2026-11-01T10:00:00Z'), c('ok', '2026-11-01T11:00:00Z')], 'bbb'],
    [[c('ok', '2026-11-01T09:00:00Z'), needsOwner('aaa', '2026-11-01T10:00:00Z')], 'aaa'],
  ]
  for (const [comments, headSha] of fixtures) {
    const go = goFor(comments, [])
    const st = reviewState({ comments, headSha, bots })
    const x = { baseRef: 'epic/1-x', labels: [], go, ownerHold: ['final', 'needs-owner'].includes(st.kind) ? st : null, headSha, headReview: st }
    assert.deepEqual(decideReview(x), decideLeafMerge({ ...x, headRef: 'work-2', red: false, ciGate: 'success', mergeableState: 'clean' }))
  }
})

const v1 = (o) => decideV1({ draft: false, authorIsPipeline: true, baseRef: 'epic/1--v1-x', headRef: 'work-1', labels: ['build:approved'],
  go: { go: false }, headReview: { kind: 'other' }, headSha: SHA, files: ['scripts/a.mjs'], ...o })
test('v1 deadlock case: CI pending, blocked → answered from review alone', () => {
  const r = v1({ ciGate: 'pending', mergeableState: 'blocked' })
  assert.equal(r.merge, true)
  assert.equal(r.code, 'merge')
})
test('v1 deadlock case: CI pending and mergeable blocked → answered from review alone', () => {
  const r = v1({ red: false, ciGate: 'pending', mergeableState: 'blocked' })
  assert.equal(r.merge, true)
  assert.equal(r.code, 'merge')
})
test('v1 C2 #339: red + review approved → hold red', () => {
  const r = v1({ red: true })
  assert.equal(r.merge, false)
  assert.equal(r.code, 'red')
})
test('v1 red:false → unchanged', () => assert.deepEqual(v1({ red: false }), v1({})))
test('v1 red beats not-pipeline', () => assert.equal(v1({ red: true, authorIsPipeline: false }).code, 'red'))
test('v1 red beats an owner ok', () => assert.equal(v1({ red: true, labels: [], go: { go: true } }).code, 'red'))
test('withoutMergeDecision ignores the Merge decision run', () => {
  const runs = [{ name: 'Merge decision', status: 'completed', conclusion: 'failure' }, { name: 'CI Gate', status: 'completed', conclusion: 'success' }]
  const f = withoutMergeDecision(runs)
  assert.deepEqual(f.map((r) => r.name), ['CI Gate'])
  assert.equal(f.some((r) => r.conclusion === 'failure'), false)
})
test('shouldEnableAuto', () => {
  assert.equal(shouldEnableAuto({ answer: { merge: true, code: 'merge' }, autoMergeOn: false }), true)
  assert.equal(shouldEnableAuto({ answer: { merge: false, code: 'no-review' }, autoMergeOn: false }), true)
  assert.equal(shouldEnableAuto({ answer: { merge: true, code: 'merge' }, autoMergeOn: true }), false)
  assert.equal(shouldEnableAuto({ answer: { merge: true, code: 'not-pipeline' }, autoMergeOn: false }), false)
})
test('canMergeNow', () => {
  const m = { merge: true, code: 'merge' }
  assert.equal(canMergeNow({ answer: m, ciGate: 'success', red: false }), true)
  assert.equal(canMergeNow({ answer: m, ciGate: 'pending', red: false }), false)
  assert.equal(canMergeNow({ answer: m, ciGate: 'success', red: true }), false)
  assert.equal(canMergeNow({ answer: { merge: false, code: 'no-review' }, ciGate: 'success', red: false }), false)
  assert.equal(canMergeNow({ answer: { merge: true, code: 'not-pipeline' }, ciGate: 'success', red: false }), false)
})
test('v1 draft → wait', () => {
  const r = v1({ draft: true })
  assert.equal(r.merge, false)
  assert.equal(r.code, 'draft')
})
test('v1 owner PR → pass, not auto-merged', () => {
  const r = v1({ authorIsPipeline: false })
  assert.equal(r.merge, true)
  assert.equal(r.code, 'not-pipeline')
  assert.equal(r.autoMerge, false)
  assert.match(r.reason, /merged by hand/)
})
test('v1 B1 revision after ok → wait', () => {
  const go = goFor([c('ok', '2026-10-28T16:00:00Z')], [k('2026-10-28T17:00:00Z')])
  const r = v1({ labels: [], go })
  assert.equal(r.merge, false)
  assert.equal(r.code, 'no-review')
})
test('v1 B2/B3 new head unreviewed → head-unreviewed naming the SHA (#3467)', () => {
  const r = v1({ headReview: { kind: 'pending' } })
  assert.equal(r.code, 'head-unreviewed')
  assert.match(r.reason, /04bfeaa0/)
})
test('v1 owner hold on an older commit doesn\'t count (:128 fixture, real reviewState)', () => {
  const cs = [needsOwner('aaa', '2026-11-01T10:00:00Z'), c('ok', '2026-11-01T11:00:00Z')]
  const run = (headSha) => {
    const st = reviewState({ comments: cs, headSha, bots })
    return v1({ labels: [], go: goFor(cs, []), headSha, ownerHold: st.kind === 'needs-owner' ? st : null })
  }
  assert.equal(run('aaa').merge, true)
  const stale = run('bbb')
  assert.equal(stale.merge, false)
  assert.equal(stale.code, 'no-review')
})
test('v1 shared-code without ok → wait (workflow file)', () => {
  for (const files of [['.github/workflows/a.yml'], ['packages/a.ts', '.github/workflows/a.yml']]) {
    const r = v1({ files })
    assert.equal(r.merge, false)
    assert.equal(r.code, 'shared-code')
    assert.equal(r.hasWf, true)
    assert.match(r.reason, /never self-merge/)
  }
  assert.equal(v1({ files: ['.github/workflows/a.yml'], go: { go: true } }).merge, true)
})
test('v1 packages-only with build:approved → pass (#2777)', () => {
  const r = v1({ files: ['packages/a/x.ts'] })
  assert.equal(r.merge, true)
  assert.equal(r.code, 'merge')
})
test('v1 missing files → need-files; a held review stays its own hold', () => {
  const r = v1({ files: undefined })
  assert.equal(r.code, 'need-files')
  assert.equal(r.needFiles, true)
  assert.equal(v1({ files: undefined, labels: [] }).code, 'no-review')
})
test('v1 non-v1 base → not-v1-base', () => {
  for (const baseRef of ['epic/1-x', 'epic/12-v1-step-1']) assert.equal(v1({ baseRef }).code, 'not-v1-base')
})
