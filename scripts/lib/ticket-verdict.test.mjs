// layer: stack
// Replay fixtures for the ticket reviewer (#2776). node --test scripts/lib/ticket-verdict.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parseVerdicts, precheck, decide, renderComment, shouldReview, releasable } from './ticket-verdict.mjs'
import { planToActions } from '../apply-decompose-plan.mjs'

const fx = (n) => readFileSync(new URL(`../fixtures/ticket-review/${n}`, import.meta.url), 'utf8')
const set = (n) => JSON.parse(fx(n)).tickets

test('a clean ticket set is go and its first ticket is released', () => {
  const d = decide(set('clean.json'), fx('clean.verdict.md'))
  assert.equal(d.ok, true)
  assert.equal(d.verdict, 'go')
  assert.deepEqual(releasable(set('clean.json')).map((r) => r.number), [1, 2])
})

test('replay #229 as first written: no-go on item 9, citing the 2026-06 priority experiment on #227', () => {
  const d = decide(set('229.json'), fx('229.verdict.md'))
  assert.equal(d.verdict, 'no-go')
  assert.deepEqual(d.tickets[0].failed, ['9'])
  assert.match(d.tickets[0].items['9'].evidence, /2026-06 experiment on #227/)
  assert.match(renderComment(d), /Tickets sent back/)
})

test('replay #2725 as first written: "force teamId" is flagged as mechanism-without-rule even when the model says go', () => {
  assert.ok(precheck(set('2725.json')[0])['8'])
  const d = decide(set('2725.json'), fx('2725.lenient.verdict.md'))
  assert.equal(d.verdict, 'no-go')
  assert.deepEqual(d.tickets[0].failed, ['8'])
})

test('a behaviour ticket with a rule but no test fails item 8; docs tickets are exempt', () => {
  assert.match(precheck({ labels: ['type:feat'], body: 'Rule: nothing leaks across teams.' })['8'].evidence, /no test/)
  assert.deepEqual(precheck({ labels: ['type:docs'], body: 'words' }), {})
  assert.deepEqual(precheck({ labels: ['type:feat'], body: 'Rule: x.\nTest: y.' }), {})
})

test('a lenient go is rejected when its own rubric fails; a missing ticket section is an error', () => {
  const bad = fx('clean.verdict.md').replace('- 9: PASS', '- 9: FAIL').replace('go\n### Rubric', 'go\n### Rubric')
  assert.equal(decide(set('clean.json'), bad).ok, false)
  assert.equal(decide(set('clean.json'), fx('229.verdict.md')).ok, false)
})

test('a malformed verdict is rejected, never approved', () => {
  assert.equal(parseVerdicts('no marker here').ok, false)
  assert.equal(decide(set('clean.json'), '<!-- ticket-review:v1 -->\n## Ticket #1\n### Verdict\nmaybe').ok, false)
})

test('needs-owner needs a question', () => {
  const v = fx('clean.verdict.md').replace('1\n### Verdict\ngo\n### Rubric\n- 3: PASS — single call site checked\n- 4: PASS — one-line change\n- 5: PASS — no casts\n- 6: PASS — one change\n- 7: PASS — mechanical', '1\n### Verdict\nneeds-owner\n### Rubric\n- 3: PASS — a\n- 4: PASS — a\n- 5: PASS — a\n- 6: PASS — a\n- 7: FAIL — cost')
  assert.match(decide(set('clean.json'), v).errors.join(), /Question/)
})

test('scope: docs/chore-only and pocs/-only sets skip the review', () => {
  assert.equal(shouldReview([{ labels: ['type:docs'], body: 'x' }, { labels: ['type:chore'], body: 'y' }]), false)
  assert.equal(shouldReview([{ labels: ['type:feat'], body: 'edit pocs/gallery/app.vue' }]), false)
  assert.equal(shouldReview([{ labels: ['type:feat'], body: 'edit packages/x/y.ts' }]), true)
  assert.equal(shouldReview(set('clean.json')), true)
})

test('releasable skips blocked and already-dispatched tickets and uses the recorded dispatch label', () => {
  const r = releasable([
    { number: 1, labels: [], body: 'a\n<!-- pipeline: epic=9 depth=1 dispatch=delegate-pi -->' },
    { number: 2, labels: [], body: 'Blocked-by: #1' },
    { number: 3, labels: ['work-this'], body: 'b' },
  ])
  assert.deepEqual(r, [{ number: 1, label: 'delegate-pi' }])
})

test('hold: with reviewTickets no child gets a trigger label, a review is requested, dispatch is recorded', () => {
  const plan = { leaf: false, children: [{ title: 'a', body: 'x', labels: [], blockedBy: [] }, { title: 'b', body: 'y', labels: [], blockedBy: [0] }] }
  const ctx = { target: 5, epic: 5, depth: 0, epic_branch: 'epic/5-x' }
  const held = planToActions(plan, { ...ctx, reviewTickets: true })
  assert.equal(held.filter((a) => a.type === 'trigger-label').length, 0)
  assert.deepEqual(held.at(-1), { type: 'request-ticket-review', epic: 5 })
  assert.match(held.find((a) => a.type === 'create').body, /dispatch=work-this/)
  const open = planToActions(plan, ctx)
  assert.equal(open.filter((a) => a.type === 'trigger-label').length, 1)
  assert.equal(open.some((a) => a.type === 'request-ticket-review'), false)
})
