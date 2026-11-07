// node --test scripts/lib/signoff-route.test.mjs  (#3238)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { signoffRoute, isHoldComment, ownerQuestionKind, isDesignHold, SIGNOFF_MARKER, HOLD_HEADING } from './signoff-route.mjs'
import { routeIssue } from './plan-route.mjs'

const T3207 = 'Add login\n**Hold for design sign-off first** (`signoff` with a `ui` mockup).\nTouches packages/crouton-auth.'
const hold = { body: `${SIGNOFF_MARKER}\n> 🤖 gate\n\n${HOLD_HEADING}\n\nfork` }
const plan = { body: '<!-- pipeline-plan:v1 -->\n### Reproduced' }
const verdict = { body: '<!-- plan-review:v1 -->\n<!-- plan-review-verdict:needs-owner -->\nx' }
const quote = { body: `The plan quotes \`${HOLD_HEADING}\` and ${SIGNOFF_MARKER} inline.` }

test('(1) a ticket asking for sign-off with no hold routes to signoff', () => {
  assert.equal(signoffRoute({ text: T3207, comments: [] }).route, 'signoff')
})
test('(2) after the marked hold → none', () => {
  assert.equal(signoffRoute({ text: T3207, comments: [hold] }).route, 'none')
})
test('(3) legacy hold (heading on its own line, no marker) → none', () => {
  assert.equal(signoffRoute({ text: T3207, comments: [{ body: `x\n${HOLD_HEADING}\n` }] }).route, 'none')
})
test('(3b) quoting the heading or marker mid-line is not asking', () => {
  assert.equal(isHoldComment(quote.body), false)
  assert.equal(signoffRoute({ text: T3207, comments: [quote] }).route, 'signoff')
})
test('(4) a ticket that does not ask → none; plan-route unchanged', () => {
  assert.equal(signoffRoute({ text: 'Fix a bug in packages/crouton-core', comments: [hold] }).route, 'none')
  assert.equal(routeIssue({ labels: ['work-this'], text: 'Fix a bug in packages/crouton-core' }).mode, 'plan')
  assert.equal(routeIssue({ labels: ['work-this'], text: 'Fix a typo in docs' }).mode, 'build')
})
test('(14) leaf ticket: hold, then plan and verdict → not a design hold', () => {
  assert.equal(isDesignHold({ labels: ['work-this'], comments: [hold, plan, verdict], noChildren: true }), false)
})
test('(15) comments only quoting the heading → not a design hold', () => {
  assert.equal(isDesignHold({ labels: [], comments: [quote, plan], noChildren: true }), false)
})
test('(16) epic + hold + no children → true even if a plan follows', () => {
  assert.equal(isDesignHold({ labels: ['epic'], comments: [hold, plan], noChildren: true }), true)
})
test('(17) epic + hold but children exist → false', () => {
  assert.equal(isDesignHold({ labels: ['epic'], comments: [hold], noChildren: false }), false)
})
test('(18) leaf whose newest gate comment is the hold → true', () => {
  assert.equal(isDesignHold({ labels: [], comments: [plan, hold], noChildren: true }), true)
})
test('(19) bot notes after the hold do not change the answer; ownerQuestionKind kinds', () => {
  const notes = [{ body: '<!-- pipeline-note -->\nworking' }, { body: '<!-- flow-checklist:3 -->\nx' }, { body: '<!-- work-run:3 -->\nx' }, { body: '🔄 the blocker has since closed' }]
  assert.equal(isDesignHold({ labels: [], comments: [hold, ...notes], noChildren: true }), true)
  assert.equal(ownerQuestionKind(hold.body), 'hold')
  assert.equal(ownerQuestionKind(plan.body), 'plan')
  assert.equal(ownerQuestionKind(verdict.body), 'verdict')
  for (const n of notes) assert.equal(ownerQuestionKind(n.body), null)
  assert.equal(ownerQuestionKind('see <!-- pipeline-plan:v1 --> above'), null)
})
