// #3846 — what ticket-review.yml does after a verdict. node --test scripts/ticket-review-actions.test.mjs
// Rule: a ticket's start depends only on the plan verdict, its own verdict and its own step's
// blockers — never on a sibling's verdict. Tests go through the real CLI (the code path the
// workflow runs) as well as the pure function, and read the workflow files for their wiring.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { reviewActions } from './ticket-review-actions.mjs'
import { decide, renderComment } from './lib/ticket-verdict.mjs'
import { normalizeSteps, renderSteps, HARNESS_BOT, PLAN_WRONG_MARKER, PLAN_GO_MARKER } from './lib/epic-steps.mjs'

const BOT = { login: HARNESS_BOT, type: 'Bot' }
const bot = (body) => ({ body, user: BOT })
const ROLLING = ['epic', 'tickets:rolling']
const STEP = (i, over = {}) => ({ title: `Step ${i}`, goal: `goal ${i}`, proves: `proves ${i}`, blockedBy: i ? [i - 1] : [], ...over })
const block = (step) => `<!-- pipeline: epic=9 depth=1 step=${step} dispatch=work-this -->`
const sub = (number, step, over = {}) => ({ number, title: `T${number}`, state: 'open', labels: ['type:feat'], body: `Rule: x. Test: y.\n${block(step)}`, ...over })
const RUBRIC = (fail = '') => ['3', '4', '5', '6', '7', '8', '9', '10'].map((id) => `- ${id}: ${id === fail ? 'FAIL' : 'PASS'} — checked`).join('\n')
const ticketSection = (n, v = 'go', fail = '') => `## Ticket #${n}\n### Verdict\n${v}\n### Rubric\n${RUBRIC(fail)}\n${v === 'plan-wrong' ? '### Why\nstep 2 needs a migration step first\n' : ''}`
const planSection = (v = 'go', fail = '') => `## Plan\n### Verdict\n${v}\n### Rubric\n${['P1', 'P2', 'P3', 'P4'].map((id) => `- ${id}: ${id === fail ? 'FAIL' : 'PASS'} — checked`).join('\n')}\n`
const verdictFile = (...parts) => `<!-- ticket-review:v1 -->\n${parts.join('\n')}`
const kinds = (lines) => lines.filter((l) => l.kind !== 'note')

test('2. plan go + ticket 1 go → steps:approved on the epic and ticket 1 starts', () => {
  const steps = normalizeSteps([STEP(0, { ticket: 11 }), STEP(1), STEP(2)])
  const subs = [sub(11, 0)]
  const d = decide(subs, verdictFile(planSection(), ticketSection(11)), { subject: 'plan' })
  assert.equal(d.ok, true)
  const lines = reviewActions({ epic: 9, subject: 'plan', labels: ROLLING, decision: d, comments: [bot(renderSteps(steps))], tickets: subs, subIssues: subs, steps })
  assert.deepEqual(kinds(lines), [{ kind: 'label', issue: 9, label: 'steps:approved' }, { kind: 'label', issue: 11, label: 'work-this' }])
})

test('2. a go ticket waits while the plan is not approved; a plan no-go holds the epic', () => {
  const steps = normalizeSteps([STEP(0, { ticket: 11 }), STEP(1)])
  const subs = [sub(11, 0)]
  const d = decide(subs, verdictFile(planSection('no-go', 'P2'), ticketSection(11)), { subject: 'plan' })
  const lines = reviewActions({ epic: 9, subject: 'plan', labels: ROLLING, decision: d, comments: [], tickets: subs, subIssues: subs, steps })
  assert.deepEqual(kinds(lines), [{ kind: 'block', issue: 9 }])
  assert.match(lines.find((l) => l.kind === 'note').text, /subject=plan/)
})

test('4. ticket 2 no-go → only ticket 2 goes back for a rewrite; go ticket 1 starts', () => {
  const subs = [sub(1, 0), sub(2, 1)]
  const d = decide(subs, verdictFile(ticketSection(1), ticketSection(2, 'no-go', '3')))
  const lines = reviewActions({ epic: 9, labels: [...ROLLING, 'steps:approved'], decision: d, comments: [], tickets: subs, subIssues: subs, steps: null })
  assert.deepEqual(kinds(lines), [
    { kind: 'label', issue: 1, label: 'work-this' },
    { kind: 'dispatch', issue: 9, workflow: 'ticket-revise.yml', inputs: { epic: '9', subject: '2' } },
  ])
})

test('6. round cap per ticket: the third bot verdict for #2 holds, a sibling at round 1 still starts', () => {
  const subs = [sub(1, 0), sub(2, 1)]
  const old = (s) => bot(`<!-- ticket-review:v1 -->\n<!-- ticket-review-verdict:no-go -->\n<!-- ticket-review-subject:${s} -->`)
  const d = decide(subs, verdictFile(ticketSection(1), ticketSection(2, 'no-go', '4')))
  const lines = reviewActions({ epic: 9, labels: ROLLING, decision: d, comments: [old('2'), old('2')], tickets: subs, subIssues: subs, steps: null })
  assert.deepEqual(kinds(lines), [{ kind: 'label', issue: 1, label: 'work-this' }, { kind: 'block', issue: 9 }])
})

test('5. plan-wrong → exactly unlabel steps:approved + block the epic; no decomposer run; started ticket untouched', () => {
  const steps = normalizeSteps([STEP(0, { ticket: 11 }), STEP(1, { ticket: 12 })])
  const subs = [sub(11, 0, { labels: ['type:feat', 'work-this'] }), sub(12, 1)]
  const d = decide([subs[1]], verdictFile(ticketSection(12, 'plan-wrong')), { subject: '12' })
  assert.equal(d.ok, true)
  const lines = reviewActions({ epic: 9, subject: '12', labels: [...ROLLING, 'steps:approved'], decision: d, comments: [bot(renderSteps(steps))], tickets: [subs[1]], subIssues: subs, steps })
  assert.deepEqual(kinds(lines), [{ kind: 'unlabel', issue: 9, label: 'steps:approved' }, { kind: 'block', issue: 9 }])
  assert.ok(!lines.some((l) => l.kind === 'dispatch'))
  // the same from a newer BOT plan-wrong comment (the worker found it), but not from a human's
  const d2 = decide([subs[1]], verdictFile(ticketSection(12)), { subject: '12' })
  const base = { epic: 9, subject: '12', labels: [...ROLLING, 'steps:approved'], decision: d2, tickets: [subs[1]], subIssues: subs, steps }
  assert.deepEqual(kinds(reviewActions({ ...base, comments: [bot(PLAN_GO_MARKER), bot(PLAN_WRONG_MARKER)] })), [{ kind: 'unlabel', issue: 9, label: 'steps:approved' }, { kind: 'block', issue: 9 }])
  assert.deepEqual(kinds(reviewActions({ ...base, comments: [bot(PLAN_GO_MARKER), { body: PLAN_WRONG_MARKER, user: { login: 'x', type: 'User' } }] })), [{ kind: 'label', issue: 12, label: 'work-this' }])
})

test('3. the next ready step is only a NOTE (written by hand), never a dispatch', () => {
  const steps = normalizeSteps([STEP(0, { ticket: 11 }), STEP(1)])
  const subs = [sub(11, 0, { state: 'closed' })]
  const d = decide([], verdictFile(planSection()), { subject: 'plan' })
  assert.equal(d.ok, true)
  const lines = reviewActions({ epic: 9, subject: 'plan', labels: ROLLING, decision: d, comments: [], tickets: [], subIssues: subs, steps })
  assert.deepEqual(kinds(lines), [{ kind: 'label', issue: 9, label: 'steps:approved' }])
  const note = lines.find((l) => l.kind === 'note' && /Step 1/.test(l.text))
  assert.match(note.text, /write its ticket by hand.*step=1/)
})

test('7. an epic without tickets:rolling keeps today\'s whole-epic flow', () => {
  const subs = [sub(1, 0, { body: 'Rule: x. Test: y.' }), sub(2, 0, { body: 'Rule: x. Test: y.\nBlocked-by: #1' })]
  const go = decide(subs, verdictFile(ticketSection(1), ticketSection(2)))
  assert.deepEqual(reviewActions({ epic: 9, labels: ['epic'], decision: go, comments: [], tickets: subs }), [
    { kind: 'label', issue: 9, label: 'tickets:approved' }, { kind: 'label', issue: 1, label: 'work-this' },
  ])
  const nogo = decide(subs, verdictFile(ticketSection(1), ticketSection(2, 'no-go', '3')))
  assert.deepEqual(reviewActions({ epic: 9, labels: ['epic'], decision: nogo, comments: [], tickets: subs }), [
    { kind: 'dispatch', issue: 9, workflow: 'ticket-revise.yml', inputs: { epic: '9' } },
  ])
  const legacy = bot('<!-- ticket-review:v1 -->\n<!-- ticket-review-verdict:no-go -->')
  assert.deepEqual(reviewActions({ epic: 9, labels: ['epic'], decision: nogo, comments: [legacy, legacy], tickets: subs }), [{ kind: 'block', issue: 9 }])
})

test('the CLI prints one JSON line per hand-off (the path ticket-review.yml runs)', () => {
  const d = mkdtempSync(join(tmpdir(), 'tra-'))
  const subs = [sub(1, 0), sub(2, 1)]
  const w = (n, v) => { writeFileSync(join(d, n), typeof v === 'string' ? v : JSON.stringify(v)); return join(d, n) }
  const decision = decide(subs, verdictFile(ticketSection(1), ticketSection(2, 'no-go', '3')))
  const out = execFileSync('node', [new URL('./ticket-review-actions.mjs', import.meta.url).pathname,
    w('decision.json', decision), w('comments.json', []), w('epic.json', { number: 9, labels: ROLLING }), w('subs.json', subs), w('steps.json', ''), '--subject', ''], { encoding: 'utf8' })
  const lines = out.trim().split('\n').map((l) => JSON.parse(l))
  assert.deepEqual(kinds(lines), [{ kind: 'label', issue: 1, label: 'work-this' }, { kind: 'dispatch', issue: 9, workflow: 'ticket-revise.yml', inputs: { epic: '9', subject: '2' } }])
})

test('the rendered verdict carries one subject marker per graded subject, and the plan go marker', () => {
  const subs = [sub(11, 0)]
  const d = decide(subs, verdictFile(planSection(), ticketSection(11)), { subject: 'plan' })
  const c = renderComment(d, { subject: 'plan' })
  assert.match(c, /<!-- ticket-review-subject:plan -->/)
  assert.match(c, /<!-- ticket-review-subject:11 -->/)
  assert.ok(c.includes(PLAN_GO_MARKER))
  assert.doesNotMatch(renderComment(decide(subs, verdictFile(ticketSection(11)))), /ticket-review-subject/)
})

// ── Workflow wiring (read the files; same approach as plan-hold.test.mjs) ──
const wf = (n) => readFileSync(new URL(`../.github/workflows/${n}`, import.meta.url), 'utf8')

test('3. nothing writes the next ticket automatically: no workflow dispatches the decomposer with step=', () => {
  const dir = new URL('../.github/workflows/', import.meta.url)
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.yml'))) {
    const t = readFileSync(new URL(f, dir), 'utf8')
    assert.ok(!/decompose-on-issue-pidev\.yml[^\n]*step=/.test(t), `${f} dispatches the decomposer with step=`)
  }
  assert.ok(!wf('on-pr-close.yml').includes('epic-next'))
})

test('ticket-review.yml has the subject input and runs the scripted hand-offs', () => {
  const t = wf('ticket-review.yml')
  assert.match(t, /subject:\n\s+description:/)
  assert.match(t, /group: ticket-review-\$\{\{ inputs\.epic \}\}-\$\{\{ inputs\.subject \}\}/)
  assert.match(t, /node scripts\/ticket-review-actions\.mjs /)
  assert.match(t, /epic-steps\.mjs narrow "\$SUBJECT"/)
  assert.ok(!/case "\$VERDICT"/.test(t), 'the verdict branching moved to scripts/ticket-review-actions.mjs')
  assert.match(t, /\{ \[ "\$SUBJECT" = plan \] && \[ -s "\$D\/steps\.json" \]; \} \|\| \[ "\$\(jq length "\$D\/tickets\.json"\)" -gt 0 \]/)
})

test('ticket-revise.yml passes the subject on to the re-review', () => {
  const t = wf('ticket-revise.yml')
  assert.match(t, /SUBJECT: \$\{\{ inputs\.subject \}\}/)
  assert.match(t, /sent-back "\$D\/comments\.json" --subject "\$SUBJECT"/)
  assert.match(t, /workflow:"ticket-review\.yml",inputs:\(\{epic:\(\$i\|tostring\)\} \+ \(if \$s == "" then \{\} else \{subject:\$s\} end\)\)/)
})
