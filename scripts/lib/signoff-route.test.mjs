// node --test scripts/lib/signoff-route.test.mjs  (#3238)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
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
test('(1b) real CLI: #3207-style body routes to signoff; a ticket that only quotes the phrase does not', () => {
  const dir = mkdtempSync(join(tmpdir(), 'so-'))
  const run = (body) => {
    const f = join(dir, 'i.txt'); writeFileSync(f, body)
    return execFileSync('node', [fileURLToPath(new URL('./signoff-route.mjs', import.meta.url)), f, '/dev/stdin', '--route'], { input: '[]' }).toString().trim()
  }
  assert.equal(run(T3207), 'signoff')
  assert.equal(run('Case: #3207 ("Hold for design sign-off first (`signoff` with a `ui` mockup)") went to plan.\n> Hold for design sign-off first'), 'none')
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
// ── #4524: the wider trigger and the mockup state ──
import { readFileSync } from 'node:fs'
import { mockupState, MOCKUP_MISSING_QUESTION } from './signoff-route.mjs'
const T4520 = 'Redesign\n**Mockup first** (owner rule for visual changes) … Stop for `ok`.'

// covers: T1
test('T1 rule: the #4520 wording and the other mockup-first phrases route to the mockup step', () => {
  for (const text of [T4520, 'Hold for the mockup before anything else.', 'Needs a design sign-off before building.', 'Please show me a mockup first.', 'Hold for design sign-off first']) {
    assert.equal(signoffRoute({ text, comments: [] }).route, 'signoff', text)
  }
})

// covers: T2
test('T2 rule: a mention is not an ask, a plain ask is', () => {
  for (const text of ['This mentions "mockup first" in quotes', '> mockup first', 'See [#2804 (mockup first)](https://x) for history.', 'Uses `mockup first` as a code span']) {
    assert.equal(signoffRoute({ text, comments: [] }).route, 'none', text)
  }
  assert.equal(signoffRoute({ text: 'Mockup first.', comments: [] }).route, 'signoff')
})

// covers: T8
test('T8: mockupState is none / posted / missing / waived', () => {
  assert.equal(mockupState({ text: 'Fix a bug', comments: [] }), 'none')
  assert.equal(mockupState({ text: T4520, comments: [plan, hold] }), 'posted')
  assert.equal(mockupState({ text: T4520, comments: [plan] }), 'missing')
  const waived = `${T4520}\n\n## Decisions\n- 2026-11-25 — owner answered yes (\`ok\`) to the plan review's question: "${MOCKUP_MISSING_QUESTION}"`
  assert.equal(mockupState({ text: waived, comments: [plan] }), 'waived')
  assert.doesNotMatch(MOCKUP_MISSING_QUESTION, /`/)
})

test('T8 wiring: the real CLI --mockup prints missing for the #4520 text with no hold, posted with one', () => {
  const dir = mkdtempSync(join(tmpdir(), 'so-'))
  const f = join(dir, 'i.md'); writeFileSync(f, `# Redesign\n\n${T4520}`)
  const cli = fileURLToPath(new URL('./signoff-route.mjs', import.meta.url))
  const c = join(dir, 'comments.json')
  const run = (comments) => { writeFileSync(c, JSON.stringify(comments)); return execFileSync('node', [cli, f, c, '--mockup']).toString().trim() }
  assert.equal(run([plan]), 'missing')
  assert.equal(run([hold]), 'posted')
})

test('T8 wiring: on-comment.yml plan-review job works out the mockup state and passes --mockup to every plan-verdict call', () => {
  const all = readFileSync(new URL('../../.github/workflows/on-comment.yml', import.meta.url), 'utf8')
  const job = all.slice(all.indexOf('\n  plan-review:\n'), all.indexOf('\n  plan-review-outcome:\n'))
  assert.ok(job.length > 100, 'plan-review job not found')
  assert.match(job, /signoff-route\.mjs "\$D\/issue\.md" "\$D\/comments\.json" --mockup > "\$D\/mockup"/)
  const calls = job.split('\n').filter((l) => l.includes('plan-verdict.mjs'))
  assert.ok(calls.length >= 3, `expected 3 plan-verdict calls, got ${calls.length}`)
  for (const l of calls) assert.match(l, /--mockup "\$MOCKUP"/, l.trim())
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
