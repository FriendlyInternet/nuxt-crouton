/**
 * #1685 WS4 contract — the loop-guards that make the event-driven label handoff (WS3) safe.
 *
 * The case that minted them: #457. A label applied from inside a run was actored as
 * `claude[bot]`; the bot-actor guard (had it existed) would have rejected it, and children ran
 * off `main`. These tests pin the three invariants BEFORE the decomposer starts emitting labels,
 * so the re-fire loop cannot come back silently.
 *
 *   node --test scripts/pipeline-loop-guard.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  botActorAllowed, jobShouldFire, decideSplit, labelForChild, decideClaim,
  ALLOWED_BOT, MAX_DEPTH, MAX_CHILDREN, WORKER_TRIGGER, CLAIM_TTL_MINUTES,
} from './pipeline-loop-guard.mjs'

// ── Invariant 1: bot-actor guard (#457) ───────────────────────────────────────────
test('a human always drives the pipeline', () => {
  assert.equal(botActorAllowed('pmcp'), true)
  assert.equal(botActorAllowed('maarten'), true)
})

test('the Harness App (nuxt-harness[bot]) is the one allowed bot', () => {
  assert.equal(botActorAllowed(ALLOWED_BOT), true)
})

test('any OTHER bot is rejected — the #457 re-fire loop', () => {
  assert.equal(botActorAllowed('claude[bot]'), false)
  assert.equal(botActorAllowed('github-actions[bot]'), false)
  assert.equal(botActorAllowed('dependabot[bot]'), false)
})

test('a missing/empty actor is rejected (fail closed)', () => {
  assert.equal(botActorAllowed(''), false)
  assert.equal(botActorAllowed(undefined), false)
  assert.equal(botActorAllowed(null), false)
})

// ── Invariant 2: exact-label gating (#535) ─────────────────────────────────────────
test('the worker job fires on an exact work-this label, not on status:in-progress', () => {
  const fire = (labelName) => jobShouldFire({ eventName: 'issues', action: 'labeled', labelName, trigger: WORKER_TRIGGER })
  assert.equal(fire('work-this'), true)
  // The re-fire loop that #535 closed: a worker adding its own status label must NOT re-trigger.
  assert.equal(fire('status:in-progress'), false)
  assert.equal(fire('delegate-pi'), false)
})

test('the decompose job fires on delegate-pi / delegate-hard only', () => {
  const fire = (labelName) => jobShouldFire({ eventName: 'issues', action: 'labeled', labelName, trigger: ['delegate-pi', 'delegate-hard'] })
  assert.equal(fire('delegate-pi'), true)
  assert.equal(fire('delegate-hard'), true)
  assert.equal(fire('work-this'), false)
  assert.equal(fire('status:in-progress'), false)
})

test('workflow_dispatch always fires; an unlabeled issue event never does', () => {
  assert.equal(jobShouldFire({ eventName: 'workflow_dispatch' }), true)
  assert.equal(jobShouldFire({ eventName: 'issues', action: 'opened', labelName: 'work-this', trigger: WORKER_TRIGGER }), false)
  assert.equal(jobShouldFire({ eventName: 'issues', action: 'unlabeled', labelName: 'work-this', trigger: WORKER_TRIGGER }), false)
})

// ── Invariant 3: depth / fan-out caps across runs (#249) ───────────────────────────
test('at the depth cap the decomposer is forced to a leaf (no infinite delegate-pi chain)', () => {
  assert.equal(decideSplit({ depth: MAX_DEPTH, isLeaf: false }).action, 'leaf')
  assert.equal(decideSplit({ depth: MAX_DEPTH + 1, isLeaf: false }).action, 'leaf')
})

test('below the cap a non-leaf splits, a leaf builds', () => {
  assert.equal(decideSplit({ depth: 0, isLeaf: false }).action, 'split')
  assert.equal(decideSplit({ depth: 1, isLeaf: true }).action, 'leaf')
})

test('a non-finite depth is treated as 0, not NaN-through', () => {
  assert.equal(decideSplit({ depth: NaN, isLeaf: false }).action, 'split')
})

test('MAX_CHILDREN over-cap is flagged', () => {
  const d = decideSplit({ depth: 0, isLeaf: false, childCount: MAX_CHILDREN + 1 })
  assert.equal(d.overCap, true)
})

// ── The label a child gets — the WS3 handoff decision ──────────────────────────────
test('labelForChild routes leaves to work-this and splits to delegate-pi', () => {
  assert.equal(labelForChild({ depth: 1, isLeaf: true }), 'work-this')
  assert.equal(labelForChild({ depth: 1, isLeaf: false }), 'delegate-pi')
  // Depth cap forces work-this even for a would-be split.
  assert.equal(labelForChild({ depth: MAX_DEPTH, isLeaf: false }), 'work-this')
})

// ── Invariant 4: the claim guard (#1890) ──────────────────────────────────────────
// Minted by three duplicate builds in one day (2026-08-05): #1478 (opened 8 min AFTER
// #1473 closed the issue), #1622, and #1889 (opened while #1888 was open). Five workflows
// already stamped `status:in-progress` and NOTHING read it — the claim signal was
// write-only. These pin the read side.
const T0 = '2026-08-05T10:00:00Z'
const mins = (n) => new Date(Date.parse(T0) + n * 60_000).toISOString()

test('a clean open issue with no PRs proceeds', () => {
  assert.equal(decideClaim({ issueState: 'open', now: T0 }).action, 'proceed')
})

test('a CLOSED issue is refused — the #1478 case', () => {
  // #1473 merged and closed #1458; the duplicate run started 8 minutes later.
  const v = decideClaim({ issueState: 'closed', now: T0 })
  assert.equal(v.action, 'refuse')
  assert.match(v.reason, /closed/i)
})

test('an OPEN PR referencing the issue is refused — the #1889 case', () => {
  const v = decideClaim({
    issueState: 'open',
    linkedPRs: [{ number: 1888, state: 'open' }],
    now: T0,
  })
  assert.equal(v.action, 'refuse')
  assert.equal(v.claimedBy, 1888)
})

test('a MERGED PR referencing the issue is refused — the work already landed', () => {
  const v = decideClaim({
    issueState: 'open',
    linkedPRs: [{ number: 1888, state: 'closed', merged: true }],
    now: T0,
  })
  assert.equal(v.action, 'refuse')
  assert.equal(v.claimedBy, 1888)
})

test('a CLOSED-unmerged PR does not refuse — a rejected attempt frees the issue', () => {
  const v = decideClaim({
    issueState: 'open',
    linkedPRs: [{ number: 1889, state: 'closed', merged: false }],
    now: T0,
  })
  assert.equal(v.action, 'proceed')
})

test('this run\'s OWN pr is ignored — a re-dispatch must not refuse itself', () => {
  const v = decideClaim({
    issueState: 'open',
    linkedPRs: [{ number: 1808, state: 'open' }],
    self: { pr: 1808 },
    now: T0,
  })
  assert.equal(v.action, 'proceed')
})

// ── #2027: the two halves of the wedge that made #1791 unworkable ────────────────────
// Both branches below existed in `decideClaim` but could never fire in production, because
// the workflow's facts step supplied neither `self` nor a `baseRef`. The result: every
// re-dispatch of an issue whose work was in flight, or whose sub-PR had merged into its epic
// branch, was refused — and the artifact-gate reported that refusal as a broken harness.

test('a PR merged into its EPIC branch has not landed — the issue stays workable (#2027)', () => {
  // `work-<n>` → `epic/<n>-<slug>` → `main`. PR #1987 merged into the middle rung; treating
  // that as "done" wedged #1791 permanently and would wedge every epic-topology issue.
  const v = decideClaim({
    issueState: 'open',
    linkedPRs: [{ number: 1987, state: 'closed', merged: true, baseRef: 'epic/1791-sales-block-editor-views' }],
    defaultBranch: 'main',
    now: T0,
  })
  assert.equal(v.action, 'proceed')
})

test('a PR merged into the DEFAULT branch still refuses — the work really did land', () => {
  const v = decideClaim({
    issueState: 'open',
    linkedPRs: [{ number: 1987, state: 'closed', merged: true, baseRef: 'main' }],
    defaultBranch: 'main',
    now: T0,
  })
  assert.equal(v.action, 'refuse')
  assert.equal(v.claimedBy, 1987)
})

test('an UNKNOWN base counts as landed — unfetchable facts keep the pre-#2027 default', () => {
  // `pulls.get` can fail; refusing is the safe side of that coin, so absence of a baseRef
  // must not silently unlock an issue.
  const v = decideClaim({
    issueState: 'open',
    linkedPRs: [{ number: 1987, state: 'closed', merged: true }],
    now: T0,
  })
  assert.equal(v.action, 'refuse')
})

test('the default branch is honoured even when it is not called main', () => {
  const v = decideClaim({
    issueState: 'open',
    linkedPRs: [{ number: 42, state: 'closed', merged: true, baseRef: 'trunk' }],
    defaultBranch: 'trunk',
    now: T0,
  })
  assert.equal(v.action, 'refuse')
})

test('self-exemption survives a merged own-PR — a re-dispatch onto our branch is not a claim', () => {
  const v = decideClaim({
    issueState: 'open',
    linkedPRs: [{ number: 1987, state: 'closed', merged: true, baseRef: 'main' }],
    self: { pr: 1987 },
    now: T0,
  })
  assert.equal(v.action, 'proceed')
})

test('a COMPETING open PR still refuses while our own branch PR is exempt', () => {
  // The exemption must be surgical: exempting our branch cannot blind the guard to a genuine
  // second runner, which is the whole point of #1890.
  const v = decideClaim({
    issueState: 'open',
    linkedPRs: [
      { number: 1987, state: 'open', headRef: 'work-1791' },
      { number: 1999, state: 'open', headRef: 'somebody-else' },
    ],
    self: { pr: 1987 },
    now: T0,
  })
  assert.equal(v.action, 'refuse')
  assert.equal(v.claimedBy, 1999)
})

test('a FRESH status:in-progress is refused', () => {
  const v = decideClaim({ issueState: 'open', inProgressSince: mins(-10), now: T0 })
  assert.equal(v.action, 'refuse')
  assert.match(v.reason, /in-progress/i)
})

test('a STALE status:in-progress proceeds — a crashed run must not wedge the issue forever', () => {
  // TTL is 2x the workers' own `timeout-minutes: 45`, so a live run can never look stale.
  const v = decideClaim({ issueState: 'open', inProgressSince: mins(-(CLAIM_TTL_MINUTES + 1)), now: T0 })
  assert.equal(v.action, 'proceed')
  assert.match(v.reason, /stale/i)
})

test('the TTL is at least twice the 45-minute worker timeout', () => {
  assert.ok(CLAIM_TTL_MINUTES >= 90, `TTL ${CLAIM_TTL_MINUTES} must exceed a live run's ceiling`)
})

test('an unparseable in-progress timestamp fails OPEN on that weak signal', () => {
  // The strong signals (closed issue / linked PR) still gate; a bad timestamp alone
  // must not block work forever.
  assert.equal(decideClaim({ issueState: 'open', inProgressSince: 'not-a-date', now: T0 }).action, 'proceed')
})

test('a strong signal outranks a stale label — closed issue still refuses', () => {
  const v = decideClaim({
    issueState: 'closed',
    inProgressSince: mins(-(CLAIM_TTL_MINUTES + 1)),
    now: T0,
  })
  assert.equal(v.action, 'refuse')
})
