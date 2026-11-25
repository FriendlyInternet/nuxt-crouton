// #3846 — what ticket-review.yml does after a verdict. node --test scripts/ticket-review-actions.test.mjs
// Rule: a ticket's start depends only on the plan verdict, its own verdict and its own step's
// blockers — never on a sibling's verdict. Tests go through the real CLI (the code path the
// workflow runs) as well as the pure function, and read the workflow files for their wiring.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, mkdirSync, chmodSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { reviewActions, retitleActions, shouldRetitle } from './ticket-review-actions.mjs'
import { decide, renderComment } from './lib/ticket-verdict.mjs'
import { normalizeSteps, renderSteps, stepsPending, HARNESS_BOT, PLAN_WRONG_MARKER, PLAN_GO_MARKER } from './lib/epic-steps.mjs'

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

test('6. round cap per ticket also counts reviews run with NO subject (they write no subject marker)', () => {
  const subs = [sub(1, 0), sub(2, 1)]
  const d = decide(subs, verdictFile(ticketSection(1), ticketSection(2, 'no-go', '4')))
  // earlier blank-subject reviews on this rolling epic: real rendered comments, no subject marker
  const earlier = Array.from({ length: 5 }, () => bot(renderComment(d)))
  assert.ok(!earlier[0].body.includes('ticket-review-subject:'))
  const lines = reviewActions({ epic: 9, labels: ROLLING, decision: d, comments: earlier, tickets: subs, subIssues: subs, steps: null })
  assert.ok(!lines.some((l) => l.kind === 'dispatch'), 'a capped ticket is never sent back for another rewrite (go ticket #1 still starts)')
  assert.deepEqual(kinds(lines), [{ kind: 'label', issue: 1, label: 'work-this' }, { kind: 'block', issue: 9 }])
  // the CLI the workflow runs agrees
  const dir = mkdtempSync(join(tmpdir(), 'tra-cap-'))
  const f = (n, v) => { const p = join(dir, n); writeFileSync(p, JSON.stringify(v)); return p }
  const out = execFileSync('node', ['scripts/ticket-review-actions.mjs', f('d.json', d), f('c.json', earlier), f('e.json', { number: 9, labels: ROLLING }), f('s.json', subs), '--subject', ''], { encoding: 'utf8' })
  assert.ok(!/ticket-revise\.yml/.test(out))
  assert.match(out, /"kind":"block"/)
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
  // (step 0's ticket #11 is closed here, so the step-1 ticket is not parked by its blocker — rule A)
  const done0 = [{ ...subs[0], state: 'closed' }, subs[1]]
  assert.deepEqual(kinds(reviewActions({ ...base, subIssues: done0, comments: [bot(PLAN_GO_MARKER), { body: PLAN_WRONG_MARKER, user: { login: 'x', type: 'User' } }] })), [{ kind: 'label', issue: 12, label: 'work-this' }])
})

test('A. a go hand-written step-1 ticket is parked while step 0\'s ticket is open, and starts once it closes', () => {
  const steps = normalizeSteps([STEP(0, { ticket: 11 }), STEP(1)])
  const ticket12 = sub(12, 1) // hand-written: a step=1 marker, no Blocked-by: line
  const d = decide([ticket12], verdictFile(ticketSection(12)), { subject: '12' })
  assert.equal(d.ok, true)
  const comments = [bot(renderSteps(steps)), bot(PLAN_GO_MARKER)]
  const run = (state11) => reviewActions({ epic: 9, subject: '12', labels: [...ROLLING, 'steps:approved'], decision: d, comments,
    tickets: [ticket12], subIssues: [sub(11, 0, { state: state11, labels: ['type:feat', 'work-this'] }), ticket12], steps })
  const open = run('open')
  assert.ok(!open.some((l) => l.kind === 'label' && l.issue === 12), 'step 1 must not start before step 0 is done')
  assert.match(open.find((l) => l.kind === 'note' && /#12/.test(l.text)).text, /parked until #11/)
  assert.deepEqual(kinds(run('closed')), [{ kind: 'label', issue: 12, label: 'work-this' }])
})

test('C. a step-list comment that is there but invalid ("ticket": "#11") holds the epic with the reason; no ticket starts', () => {
  const steps = normalizeSteps([STEP(0, { ticket: 11 }), STEP(1)])
  const rendered = renderSteps(steps)
  assert.match(rendered, /"ticket": 11/)
  const broken = rendered.replace('"ticket": 11', '"ticket": "#11"')
  const ticket12 = sub(12, 1)
  const d = decide([ticket12], verdictFile(ticketSection(12)), { subject: '12' })
  assert.equal(d.ok, true)
  const comments = [bot(broken), bot(PLAN_GO_MARKER)]
  const subIssues = [sub(11, 0, { labels: ['type:feat', 'work-this'] }), ticket12]
  // the workflow passes no steps: `epic-steps.mjs steps` prints nothing for an unreadable list
  const lines = reviewActions({ epic: 9, subject: '12', labels: [...ROLLING, 'steps:approved'], decision: d, comments,
    tickets: [ticket12], subIssues, steps: null })
  assert.ok(!lines.some((l) => l.kind === 'label' && l.label === 'work-this'), 'no ticket starts on an unreadable step list')
  assert.ok(lines.some((l) => l.kind === 'block' && l.issue === 9), 'the epic gets status:blocked')
  assert.equal(lines.filter((l) => l.kind === 'block').length, 1)
  assert.match(lines.find((l) => l.kind === 'note').text, /cannot be read: step\[0\]\.ticket must be an issue number/)
  assert.ok(!lines.some((l) => l.kind === 'note' && /finished/.test(l.text)), 'the epic never counts as finished')
  assert.notEqual(stepsPending({ labels: ROLLING, comments, subIssues: subIssues.map((s) => ({ ...s, state: 'closed' })) }), 0)
})

test('C. an epic with no step-list comment behaves as before (a go ticket starts)', () => {
  const ticket12 = sub(12, 1)
  const d = decide([ticket12], verdictFile(ticketSection(12)), { subject: '12' })
  const lines = reviewActions({ epic: 9, subject: '12', labels: ROLLING, decision: d, comments: [],
    tickets: [ticket12], subIssues: [ticket12], steps: null })
  assert.deepEqual(lines, [{ kind: 'label', issue: 12, label: 'work-this' }])
  assert.equal(stepsPending({ labels: ROLLING, comments: [], subIssues: [{ ...ticket12, state: 'closed' }] }), 0)
})

test('B. step list go → step list no-go → ticket go does not start; a new step-list go lets it start', () => {
  const steps = normalizeSteps([STEP(0, { ticket: 11 })])
  const subs = [sub(11, 0)]
  const base = { epic: 9, tickets: subs, subIssues: subs, steps }
  const planGo = decide([], verdictFile(planSection()), { subject: 'plan' })
  const planNoGo = decide([], verdictFile(planSection('no-go', 'P2')), { subject: 'plan' })
  assert.equal(planGo.ok && planNoGo.ok, true)
  const ticketGo = decide(subs, verdictFile(ticketSection(11)), { subject: '11' })
  const posted = (d) => bot(renderComment(d, { subject: d.plan ? 'plan' : '11' }))
  const comments = [bot(renderSteps(steps))]
  // 1. step list go → steps:approved
  assert.deepEqual(kinds(reviewActions({ ...base, subject: 'plan', labels: ROLLING, decision: planGo, comments }))[0], { kind: 'label', issue: 9, label: 'steps:approved' })
  comments.push(posted(planGo))
  // 2. step list re-review no-go → steps:approved comes off, the epic holds, nothing starts
  const nogo = reviewActions({ ...base, subject: 'plan', labels: [...ROLLING, 'steps:approved'], decision: planNoGo, comments })
  assert.deepEqual(kinds(nogo), [{ kind: 'unlabel', issue: 9, label: 'steps:approved' }, { kind: 'block', issue: 9 }])
  comments.push(posted(planNoGo))
  // 3. ticket go → no work-this, with the label removed AND even if a stale label were still on
  for (const labels of [ROLLING, [...ROLLING, 'steps:approved']]) {
    const lines = reviewActions({ ...base, subject: '11', labels, decision: ticketGo, comments })
    assert.ok(!lines.some((l) => l.kind === 'label' && l.label === 'work-this'), `no start with labels ${labels}`)
  }
  // 4. a new step-list go → the ticket starts
  comments.push(posted(planGo))
  const after = reviewActions({ ...base, subject: '11', labels: [...ROLLING, 'steps:approved'], decision: ticketGo, comments })
  assert.deepEqual(kinds(after), [{ kind: 'label', issue: 11, label: 'work-this' }])
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
  // #4456: the whole-epic path removes tickets:approved first (moved here from ticket-review.yml)
  const unapprove = { kind: 'unlabel', issue: 9, label: 'tickets:approved' }
  assert.deepEqual(reviewActions({ epic: 9, labels: ['epic'], decision: go, comments: [], tickets: subs }), [
    unapprove, { kind: 'label', issue: 9, label: 'tickets:approved' }, { kind: 'label', issue: 1, label: 'work-this' },
  ])
  const nogo = decide(subs, verdictFile(ticketSection(1), ticketSection(2, 'no-go', '3')))
  assert.deepEqual(reviewActions({ epic: 9, labels: ['epic'], decision: nogo, comments: [], tickets: subs }), [
    unapprove, { kind: 'dispatch', issue: 9, workflow: 'ticket-revise.yml', inputs: { epic: '9' } },
  ])
  const legacy = bot('<!-- ticket-review:v1 -->\n<!-- ticket-review-verdict:no-go -->')
  assert.deepEqual(reviewActions({ epic: 9, labels: ['epic'], decision: nogo, comments: [legacy, legacy], tickets: subs }), [unapprove, { kind: 'block', issue: 9 }])
})

// covers: T5
test('T5 (#4456): a ticket subject on an epic without tickets:rolling touches only that ticket', () => {
  const plain = (n) => sub(n, 0, { body: 'Rule: x. Test: y.' })
  const subs = [plain(11), plain(12), plain(13)]
  const labels = ['epic', 'tickets:approved']
  const one = [subs[0]]
  const go = decide(one, verdictFile(ticketSection(11)), { subject: '11' })
  assert.equal(go.ok, true, String(go.errors))
  const goLines = kinds(reviewActions({ epic: 10, subject: '11', labels, decision: go, comments: [], tickets: one, subIssues: subs }))
  assert.deepEqual(goLines, [{ kind: 'unlabel', issue: 11, label: 'work-this' }, { kind: 'label', issue: 11, label: 'work-this' }])
  assert.ok(!goLines.some((l) => l.label === 'tickets:approved'), 'a per-ticket review leaves tickets:approved alone')
  const nogo = decide(one, verdictFile(ticketSection(11, 'no-go', '3')), { subject: '11' })
  const nogoLines = kinds(reviewActions({ epic: 10, subject: '11', labels, decision: nogo, comments: [], tickets: one, subIssues: subs }))
  assert.deepEqual(nogoLines, [{ kind: 'dispatch', issue: 10, workflow: 'ticket-revise.yml', inputs: { epic: '10', subject: '11' } }])
  // a blank subject keeps the whole-epic flow, which removes tickets:approved first
  const all = decide(subs, verdictFile(ticketSection(11), ticketSection(12), ticketSection(13)))
  const blank = reviewActions({ epic: 10, subject: '', labels, decision: all, comments: [], tickets: subs })
  assert.deepEqual(blank[0], { kind: 'unlabel', issue: 10, label: 'tickets:approved' })
  assert.deepEqual(blank.slice(1).map((l) => l.issue), [10, 11, 12, 13])
})

// covers: T5
test('T5 (#4456): the CLI with --subject 11 on a non-rolling epic labels only #11', () => {
  const d = mkdtempSync(join(tmpdir(), 'tra-gate-'))
  const w = (n, v) => { writeFileSync(join(d, n), typeof v === 'string' ? v : JSON.stringify(v)); return join(d, n) }
  const plain = (n) => sub(n, 0, { body: 'Rule: x. Test: y.' })
  const subs = [plain(11), plain(12), plain(13)]
  const decision = decide([subs[0]], verdictFile(ticketSection(11)), { subject: '11' })
  const out = execFileSync('node', [new URL('./ticket-review-actions.mjs', import.meta.url).pathname,
    w('decision.json', decision), w('comments.json', []), w('epic.json', { number: 10, labels: ['epic', 'tickets:approved'] }), w('subs.json', subs), w('steps.json', ''), '--subject', '11'], { encoding: 'utf8' })
  const lines = out.trim().split('\n').map((l) => JSON.parse(l))
  assert.deepEqual(kinds(lines), [{ kind: 'unlabel', issue: 11, label: 'work-this' }, { kind: 'label', issue: 11, label: 'work-this' }])
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
  assert.match(t, /node scripts\/ticket-review-actions\.mjs gather "\$D\/comments\.json" "\$D\/epic\.json" "\$D\/tickets\.json" "\$D\/steps\.json" --subject "\$SUBJECT"/)
  // a gather hold skips the reviewer and the verdict step (one comment, from the gather step)
  assert.match(t, /- name: Gather the epic and its tickets\n\s+id: gather\n/)
  assert.match(t, /- id: pi\n\s+if: \$\{\{ steps\.gather\.outputs\.held != 'true' \}\}/)
  assert.match(t, /- name: Post the verdict and release\n\s+if: \$\{\{ !cancelled\(\) && steps\.gather\.outputs\.held != 'true' \}\}/)
})

// ── #4353: the reviewer's suggested title renames a go ticket before it starts ──
const BAD = 'velo: the bookings cancel route returns 404'
const GOOD = 'Cancelling a booking works again'
const titled = (n, suggestion, v = 'go', fail = '') => ticketSection(n, v, fail).replace(`## Ticket #${n}\n`, `## Ticket #${n}\nSuggested title: ${suggestion}\n`)

test('T5: go + valid suggestion + rule-breaking title → a retitle line before the label, legacy and rolling', () => {
  const legacySubs = [sub(1, 0, { title: BAD, body: 'Rule: x. Test: y.' })]
  const ld = decide(legacySubs, verdictFile(titled(1, GOOD)))
  assert.equal(ld.ok, true, String(ld.errors))
  const legacy = reviewActions({ epic: 9, labels: ['epic'], decision: ld, comments: [], tickets: legacySubs })
  const r1 = legacy.findIndex((l) => l.kind === 'retitle')
  assert.deepEqual(legacy[r1], { kind: 'retitle', issue: 1, title: GOOD, seenTitle: BAD })
  assert.ok(r1 < legacy.findIndex((l) => l.kind === 'label' && l.issue === 1))

  const steps = normalizeSteps([STEP(0, { ticket: 11 }), STEP(1)])
  const subs = [sub(11, 0, { title: BAD })]
  const rd = decide(subs, verdictFile(planSection(), titled(11, GOOD)), { subject: 'plan' })
  const rolling = reviewActions({ epic: 9, subject: 'plan', labels: ROLLING, decision: rd, comments: [bot(renderSteps(steps))], tickets: subs, subIssues: subs, steps })
  const r2 = rolling.findIndex((l) => l.kind === 'retitle')
  assert.deepEqual(rolling[r2], { kind: 'retitle', issue: 11, title: GOOD, seenTitle: BAD })
  const lab = rolling.findIndex((l) => l.kind === 'label' && l.issue === 11)
  assert.ok(lab > r2, JSON.stringify(rolling))
})

test('T6: no retitle for a no-go ticket, a bad suggestion, or a title that already follows the rule', () => {
  const subs = [sub(1, 0, { title: BAD, body: 'Rule: x. Test: y.' })]
  assert.deepEqual(retitleActions(decide(subs, verdictFile(titled(1, GOOD, 'no-go', '3')))), [])
  assert.deepEqual(retitleActions(decide(subs, verdictFile(titled(1, 'x'.repeat(141))))), [])
  assert.deepEqual(retitleActions(decide(subs, verdictFile(titled(1, 'fix(velo): cancel works')))), [])
  const fine = [sub(1, 0, { title: 'Bookings can be cancelled', body: 'Rule: x. Test: y.' })]
  assert.deepEqual(retitleActions(decide(fine, verdictFile(titled(1, GOOD)))), [])
})

test('T7: rename only when the live title still equals the one the review saw (pure + CLI)', () => {
  const a = { kind: 'retitle', issue: 1, title: GOOD, seenTitle: BAD }
  assert.equal(shouldRetitle(a, BAD), true)
  assert.equal(shouldRetitle(a, 'Someone renamed it'), false)
  const cli = (live) => spawnSync('node', [new URL('./ticket-review-actions.mjs', import.meta.url).pathname, 'retitle-ok', JSON.stringify(a), live]).status
  assert.equal(cli(BAD), 0)
  assert.equal(cli('Someone renamed it'), 1)
})

test('T8: ticket-review.yml feeds the title check to the reviewer and runs the retitle line', () => {
  const t = wf('ticket-review.yml')
  assert.match(t, /node scripts\/lib\/title-rule\.mjs notes "\$D\/tickets\.json" >> "\$D\/epic\.md"/)
  const c = t.match(/^\s+retitle\)[^\n]*$/m)?.[0] || ''
  assert.match(c, /ticket-review-actions\.mjs retitle-ok "\$A" "\$LIVE"/)
  assert.match(c, /gh issue edit "\$N" --title/)
  // the notes run after tickets.json is written
  assert.ok(t.indexOf('title-rule.mjs notes') > t.indexOf('> "$D/tickets.json"'))
})

test('ticket-revise.yml passes the subject on to the re-review', () => {
  const t = wf('ticket-revise.yml')
  assert.match(t, /SUBJECT: \$\{\{ inputs\.subject \}\}/)
  assert.match(t, /sent-back "\$D\/comments\.json" --subject "\$SUBJECT"/)
  assert.match(t, /workflow:"ticket-review\.yml",inputs:\(\{epic:\(\$i\|tostring\)\} \+ \(if \$s == "" then \{\} else \{subject:\$s\} end\)\)/)
})

// ── subject=plan gather: the workflow's own commands, run in bash with a fake `gh` (#3846 review) ──
// The lines are read out of ticket-review.yml, so the test runs exactly what the gather step runs.
function runGather({ comments, subs, labels = ROLLING, subject = 'plan' }) {
  const d = mkdtempSync(join(tmpdir(), 'trg-'))
  const bin = join(d, 'bin'); mkdirSync(bin)
  writeFileSync(join(bin, 'gh'), `#!/usr/bin/env bash\nprintf '%s\\0' "$@" >> "${join(d, 'gh.log')}"\nprintf '\\036' >> "${join(d, 'gh.log')}"\n`)
  chmodSync(join(bin, 'gh'), 0o755)
  writeFileSync(join(d, 'comments.json'), JSON.stringify(comments))
  writeFileSync(join(d, 'subs.json'), JSON.stringify(subs))
  writeFileSync(join(d, 'epic.json'), JSON.stringify({ number: 9, labels }))
  const t = wf('ticket-review.yml')
  const pick = (re) => { const l = t.split('\n').find((x) => re.test(x)); assert.ok(l, `workflow line ${re}`); return l.trim() }
  const script = ['set -euo pipefail',
    pick(/node scripts\/lib\/epic-steps\.mjs steps /), pick(/node scripts\/lib\/epic-steps\.mjs narrow /),
    pick(/node scripts\/ticket-review-actions\.mjs gather /)].join('\n')
  const out = join(d, 'out')
  writeFileSync(out, '')
  const r = spawnSync('bash', ['-c', script], { cwd: new URL('..', import.meta.url).pathname, encoding: 'utf8',
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, D: d, SUBJECT: subject, EPIC: '9', GITHUB_OUTPUT: out } })
  const log = existsSync(join(d, 'gh.log')) ? readFileSync(join(d, 'gh.log'), 'utf8') : ''
  const calls = log.split('\x1e').filter(Boolean).map((l) => l.split('\0').filter(Boolean))
  return { status: r.status, stdout: r.stdout, stderr: r.stderr, calls, output: readFileSync(out, 'utf8'), steps: readFileSync(join(d, 'steps.json'), 'utf8') }
}

test('C. subject=plan: the reviewer\'s broken list ("ticket": "#11") holds the epic with the field that is wrong', () => {
  const broken = renderSteps(normalizeSteps([STEP(0, { ticket: 11 }), STEP(1)])).replace('"ticket": 11', '"ticket": "#11"')
  const r = runGather({ comments: [bot(broken)], subs: [sub(11, 0)], labels: [...ROLLING, 'steps:approved'] })
  assert.equal(r.status, 0, r.stderr + r.stdout)
  assert.equal(r.steps, '', 'no step list is passed on')
  assert.match(r.stderr, /unreadable step list: step\[0\]\.ticket must be an issue number/)
  assert.match(r.output, /^held=true$/m, 'the reviewer and verdict steps are skipped')
  assert.deepEqual(r.calls.filter((c) => c[1] === 'edit'), [
    ['issue', 'edit', '9', '--remove-label', 'steps:approved'], ['issue', 'edit', '9', '--add-label', 'status:blocked'],
  ])
  const comments = r.calls.filter((c) => c[1] === 'comment')
  assert.equal(comments.length, 1, 'one comment')
  assert.equal(comments[0][2], '9')
  assert.match(comments[0][4], /cannot be read: step\[0\]\.ticket must be an issue number or null, got "#11"/)
})

test('C. subject=plan: a valid list goes on to the review, a missing list fails as before', () => {
  const valid = runGather({ comments: [bot(renderSteps(normalizeSteps([STEP(0, { ticket: 11 }), STEP(1)])))], subs: [sub(11, 0)] })
  assert.equal(valid.status, 0, valid.stderr + valid.stdout)
  assert.equal(JSON.parse(valid.steps).length, 2)
  assert.deepEqual(valid.calls, [])
  assert.equal(valid.output, '')
  const missing = runGather({ comments: [], subs: [sub(11, 0)] })
  assert.equal(missing.status, 1)
  assert.equal(missing.steps, '')
  assert.match(missing.stdout, /::error::epic #9 has no open sub-issues to review/)
  assert.deepEqual(missing.calls, [])
  assert.equal(missing.output, '')
})

test('epic-steps.mjs steps: no step list (exit 0, nothing) is told apart from an unreadable one (exit 3)', () => {
  const d = mkdtempSync(join(tmpdir(), 'es-'))
  const cli = new URL('./lib/epic-steps.mjs', import.meta.url).pathname
  const run = (comments) => { writeFileSync(join(d, 'c.json'), JSON.stringify(comments)); return spawnSync('node', [cli, 'steps', join(d, 'c.json')], { encoding: 'utf8' }) }
  const none = run([])
  assert.equal(none.status, 0); assert.equal(none.stdout, '')
  const bad = run([bot(`${'<!-- epic-steps:v1 -->'}\n\`\`\`json\n[{"title":"t","goal":"g","proves":"p","ticket":"#11"}]\n\`\`\``)])
  assert.equal(bad.status, 3); assert.equal(bad.stdout, ''); assert.match(bad.stderr, /step\[0\]\.ticket/)
})
