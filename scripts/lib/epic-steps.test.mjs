// Rolling epics (#3846): plan reviewed once, then one ticket at a time.
//   node --test scripts/lib/epic-steps.test.mjs
// Rules under test:
//   A. a ticket's start depends only on the plan verdict, its own verdict and its own step's
//      blockers — never on a sibling's verdict;
//   B. a rolling epic counts as finished only when every step in its step list has a closed ticket,
//      never just because every sub-issue written so far is closed.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  normalizeSteps, renderSteps, parseSteps, stepsPending, narrowToSubject, splitVerdict, nextAction,
  countRounds, planWrongOnRecord, stepOf, subjectMarker, PlanError, isHarnessBot, HARNESS_BOT,
  PLAN_WRONG_MARKER, PLAN_GO_MARKER, ROLLING_LABEL,
} from './epic-steps.mjs'
import { isHarnessBot as reExported } from '../ticket-revise.mjs'

const BOT = { login: HARNESS_BOT, type: 'Bot' }
const HUMAN = { login: 'pmcp', type: 'User' }
const bot = (body) => ({ body, user: BOT })
const human = (body) => ({ body, user: HUMAN })
const STEP = (i, over = {}) => ({ title: `Step ${i}`, goal: `goal ${i}`, proves: `proves ${i}`, blockedBy: i ? [i - 1] : [], ...over })
const steps4 = (over = {}) => normalizeSteps([0, 1, 2, 3].map((i) => STEP(i, over[i] || {})))
const listComment = (steps) => bot(renderSteps(steps))
const verdict = (subject, v = 'no-go') => bot(`<!-- ticket-review:v1 -->\n<!-- ticket-review-verdict:${v} -->\n${subjectMarker(subject)}\n…`)
const sub = (number, state, step = null) => ({ number, state, body: step === null ? 'x' : `x\n<!-- pipeline: epic=9 depth=1 step=${step} -->` })

test('isHarnessBot moved to lib and is re-exported from ticket-revise.mjs unchanged', () => {
  assert.equal(reExported, isHarnessBot)
  assert.equal(isHarnessBot(bot('x')), true)
  assert.equal(isHarnessBot(human('x')), false)
  assert.equal(isHarnessBot('bare string'), false)
})

test('the step list round-trips through its bot comment; a non-bot list is ignored', () => {
  const s = steps4({ 0: { ticket: 11 } })
  assert.deepEqual(parseSteps([listComment(s)]), s)
  assert.equal(parseSteps([human(renderSteps(s))]), null)
  assert.equal(parseSteps([]), null)
  // the newest bot list wins (edited in place, or re-posted)
  const edited = normalizeSteps([STEP(0), STEP(1)])
  assert.deepEqual(parseSteps([listComment(s), listComment(edited)]), edited)
})

test('15. normalizeSteps rejects a missing goal, a self/cyclic blockedBy and a non-integer ticket', () => {
  assert.throws(() => normalizeSteps([STEP(0, { goal: '' })]), (e) => e instanceof PlanError && /goal/.test(e.message))
  assert.throws(() => normalizeSteps([STEP(0, { blockedBy: [0] })]), /itself/)
  assert.throws(() => normalizeSteps([STEP(0, { blockedBy: [1] }), STEP(1, { blockedBy: [0] })]), /cycle/)
  assert.throws(() => normalizeSteps([STEP(0, { ticket: 'x' })]), /ticket/)
  assert.throws(() => normalizeSteps([STEP(0, { ticket: 1.5 })]), /ticket/)
  assert.throws(() => normalizeSteps([]), /non-empty/)
  assert.deepEqual(normalizeSteps([STEP(0)])[0], { step: 0, title: 'Step 0', goal: 'goal 0', proves: 'proves 0', blockedBy: [], needsSplit: false, ticket: null })
})

test('1. new epic (step list + only ticket 1) → nextAction asks for the plan review', () => {
  const s = steps4({ 0: { ticket: 11 } })
  assert.deepEqual(nextAction({ rolling: true, plan: {}, steps: s, tickets: { 11: { state: 'open', step: 0 } } }), [{ type: 'plan-review' }])
})

test('2. plan go + ticket 1 go → ticket 1 starts (and nothing is written for blocked steps)', () => {
  const s = steps4({ 0: { ticket: 11 } })
  const got = nextAction({ rolling: true, plan: { verdict: 'go' }, steps: s, tickets: { 11: { state: 'open', verdict: 'go', started: false, step: 0 } } })
  assert.deepEqual(got, [{ type: 'start', n: 11, label: 'work-this' }])
  // already started → no second start
  assert.deepEqual(nextAction({ rolling: true, plan: { verdict: 'go' }, steps: s, tickets: { 11: { state: 'open', verdict: 'go', started: true, step: 0 } } }), [])
})

test('3. step 0 closed, step 1 has no ticket → write-ticket {step:1} is REPORTED (one per ready step)', () => {
  const s = normalizeSteps([STEP(0, { ticket: 11 }), STEP(1, { blockedBy: [0] }), STEP(2, { blockedBy: [0] }), STEP(3, { blockedBy: [1] })])
  const got = nextAction({ rolling: true, plan: { verdict: 'go' }, steps: s, tickets: { 11: { state: 'closed', step: 0 } } })
  assert.deepEqual(got, [{ type: 'write-ticket', step: 1 }, { type: 'write-ticket', step: 2 }])
})

test('3. a hand-written next ticket is reviewed alone: narrowToSubject', () => {
  const s = normalizeSteps([STEP(0, { ticket: 11 }), STEP(1), STEP(2, { blockedBy: [] })])
  const tickets = [{ number: 11, state: 'closed' }, sub(12, 'open', 1), sub(13, 'open', 2)]
  assert.deepEqual(narrowToSubject({ subject: '12', tickets, steps: s }).map((t) => t.number), [12])
  assert.deepEqual(narrowToSubject({ subject: '', tickets, steps: s }).map((t) => t.number), [12, 13])
  // plan → the open tickets of steps with no blocker: step 0's is closed, step 2 is a root → #13
  assert.deepEqual(narrowToSubject({ subject: 'plan', tickets, steps: s }).map((t) => t.number), [13])
  // plan with every root ticket closed → nothing (the plan is then reviewed alone)
  assert.deepEqual(narrowToSubject({ subject: 'plan', tickets: [{ number: 11, state: 'closed' }], steps: s }), [])
})

test('4. ticket 2 no-go → ticket 2 held (and the step blocked by it), nothing else held', () => {
  // steps: 0 → 1 → 2 (2 waits on 1); 3 independent
  const s = normalizeSteps([STEP(0, { ticket: 1 }), STEP(1, { ticket: 2 }), STEP(2, { ticket: 4, blockedBy: [1] }), STEP(3, { ticket: 3, blockedBy: [] })])
  const d = { tickets: [{ number: 1, verdict: 'go' }, { number: 2, verdict: 'no-go' }, { number: 3, verdict: 'go' }, { number: 4, verdict: 'go' }] }
  const r = splitVerdict(d, s)
  assert.deepEqual(r.start, [1, 3])
  assert.deepEqual(r.hold, [2, 4])
  // without a step list (an existing epic opted in by label) only the no-go ticket holds
  assert.deepEqual(splitVerdict(d, null), { start: [1, 3, 4], hold: [2] })
  // a needs-owner ticket holds itself, never a go sibling
  assert.deepEqual(splitVerdict({ tickets: [{ number: 1, verdict: 'go' }, { number: 2, verdict: 'needs-owner' }] }, null), { start: [1], hold: [2] })
})

test('4. nextAction per ticket: a no-go ticket is revised, its go sibling still starts', () => {
  const got = nextAction({ rolling: true, plan: { verdict: 'go' }, steps: null, tickets: { 1: { state: 'open', verdict: 'go' }, 2: { state: 'open', verdict: 'no-go', round: 1 } } })
  assert.deepEqual(got, [{ type: 'start', n: 1, label: 'work-this' }, { type: 'revise', n: 2 }])
})

test('5. ticket finds the plan wrong → plan held for the orchestrator; edited list → plan review again', () => {
  const s = steps4({ 0: { ticket: 11 }, 1: { ticket: 12 } })
  const t = { 11: { state: 'open', verdict: 'go', started: true }, 12: { state: 'open', verdict: 'plan-wrong' } }
  assert.deepEqual(nextAction({ rolling: true, plan: { verdict: 'go' }, steps: s, tickets: t }), [{ type: 'hold', target: 'plan', reason: 'plan-wrong' }])
  // a newer bot plan-wrong comment (e.g. from the worker) holds too
  assert.deepEqual(nextAction({ rolling: true, plan: { verdict: 'go', wrong: true }, steps: s, tickets: { 11: t[11] } }), [{ type: 'hold', target: 'plan', reason: 'plan-wrong' }])
  // after the hold `steps:approved` is gone and the list was edited → the plan needs its review again
  assert.deepEqual(nextAction({ rolling: true, plan: { verdict: null, wrong: true }, steps: s, tickets: { 11: t[11] } }), [{ type: 'plan-review' }])
})

test('5. planWrongOnRecord: only a BOT plan-wrong comment newer than the last plan go counts', () => {
  assert.equal(planWrongOnRecord([bot(PLAN_GO_MARKER), bot(PLAN_WRONG_MARKER)]), true)
  assert.equal(planWrongOnRecord([bot(PLAN_WRONG_MARKER), bot(PLAN_GO_MARKER)]), false)
  assert.equal(planWrongOnRecord([bot(PLAN_GO_MARKER), human(PLAN_WRONG_MARKER)]), false)
})

test('6. the round cap counts per ticket and per plan; a non-bot verdict never counts', () => {
  const c = [verdict('5'), verdict('5'), verdict('5'), verdict('6'), verdict('plan'), { ...verdict('6'), user: HUMAN }]
  assert.equal(countRounds(c, '5'), 4)
  assert.equal(countRounds(c, '6'), 2)
  assert.equal(countRounds(c, 'plan'), 2)
  assert.equal(countRounds(c, '7'), 1)
  // marker for #5 does not count for #50
  assert.equal(countRounds([verdict('50')], '5'), 1)
  const t = (round) => ({ 5: { state: 'open', verdict: 'no-go', round } })
  assert.deepEqual(nextAction({ rolling: true, plan: { verdict: 'go' }, tickets: t(countRounds(c, '5')) }), [{ type: 'hold', target: 5, reason: 'round-cap' }])
  assert.deepEqual(nextAction({ rolling: true, plan: { verdict: 'go' }, tickets: t(countRounds(c, '6')) }), [{ type: 'revise', n: 5 }])
  // a plan no-go holds the plan (the step list is fixed by hand); at round 3 the reason says so
  assert.deepEqual(nextAction({ rolling: true, plan: { verdict: 'no-go', round: 3 }, steps: steps4() }), [{ type: 'hold', target: 'plan', reason: 'round-cap' }])
})

test('7. an epic without tickets:rolling gets nothing from nextAction (today\'s flow decides)', () => {
  assert.deepEqual(nextAction({ rolling: false, plan: {}, steps: steps4() }), [])
})

test('9. stepsPending: step 0 merged → 3 steps still pending; all closed → 0', () => {
  const labels = ['epic', ROLLING_LABEL]
  const s = steps4({ 0: { ticket: 11 } })
  assert.equal(stepsPending({ labels, comments: [listComment(s)], subIssues: [sub(11, 'closed')] }), 3)
  const all = steps4({ 0: { ticket: 11 }, 1: { ticket: 12 }, 2: { ticket: 13 }, 3: { ticket: 14 } })
  const closed = [11, 12, 13, 14].map((n) => sub(n, 'closed'))
  assert.equal(stepsPending({ labels, comments: [listComment(all)], subIssues: closed }), 0)
  // a ticket that exists but is open still counts as pending
  assert.equal(stepsPending({ labels, comments: [listComment(all)], subIssues: [...closed.slice(0, 3), sub(14, 'open')] }), 1)
  // a step list posted by a non-bot account is ignored → fail open to 0
  assert.equal(stepsPending({ labels, comments: [human(renderSteps(s))], subIssues: [sub(11, 'closed')] }), 0)
  // no tickets:rolling → 0, whatever the comments say
  assert.equal(stepsPending({ labels: ['epic'], comments: [listComment(s)], subIssues: [sub(11, 'closed')] }), 0)
  // a hand-written ticket with step=1 finishes step 1 even when the list's ticket is null
  assert.equal(stepsPending({ labels, comments: [listComment(normalizeSteps([STEP(0, { ticket: 11 }), STEP(1)]))], subIssues: [sub(11, 'closed'), sub(12, 'closed', 1)] }), 0)
})

test('9. nextAction reports done only when every step has a closed ticket', () => {
  const s = normalizeSteps([STEP(0, { ticket: 11 }), STEP(1)])
  assert.notDeepEqual(nextAction({ rolling: true, plan: { verdict: 'go' }, steps: s, tickets: { 11: { state: 'closed' } } }), [{ type: 'done' }])
  assert.deepEqual(nextAction({ rolling: true, plan: { verdict: 'go' }, steps: s, tickets: { 11: { state: 'closed' }, 12: { state: 'closed', step: 1 } } }), [{ type: 'done' }])
})

test('stepOf reads step=<k> from the pipeline block only', () => {
  assert.equal(stepOf('<!-- pipeline: epic=9 depth=1 step=2 dispatch=work-this -->'), 2)
  assert.equal(stepOf('step=2 in prose'), null)
  assert.equal(stepOf(''), null)
})
