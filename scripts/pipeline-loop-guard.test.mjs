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
  botActorAllowed, jobShouldFire, decideSplit, labelForChild,
  ALLOWED_BOT, MAX_DEPTH, MAX_CHILDREN, WORKER_TRIGGER,
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
