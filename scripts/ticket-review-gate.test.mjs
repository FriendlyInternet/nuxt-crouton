// #4456 — the ticket-review gate: a chat-made ticket under an epic is reviewed before it is built.
// node --test scripts/ticket-review-gate.test.mjs
// Tests go through the pure rules, the real CLI (with a fake `gh` on PATH, so handoff-exec runs for
// real), the real ticket-review-actions path, the real wave release, and the workflow files.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, chmodSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gateDecision, gateRelease, pipelineMade } from './ticket-review-gate.mjs'
import { reviewActions } from './ticket-review-actions.mjs'
import { releaseReady } from './wave-release.mjs'
import { decide, renderComment } from './lib/ticket-verdict.mjs'
import { HARNESS_BOT } from './lib/epic-steps.mjs'

const BOT = { login: HARNESS_BOT, type: 'Bot' }
const PMCP = { login: 'pmcp', type: 'User' }
const EPIC = { number: 20, labels: ['epic', 'tickets:approved'] }
const BLOCK = '<!-- pipeline: epic=20 depth=1 dispatch=work-this -->'
const ticket = (over = {}) => ({ number: 21, labels: ['type:feat', 'work-this'], body: 'Rule: x. Test: y.', author: PMCP, ...over })

// A real rendered verdict comment (the shape ticket-review.yml posts), authored by the bot.
const RUBRIC = (fail = '') => ['3', '4', '5', '6', '7', '8', '9', '10'].map((id) => `- ${id}: ${id === fail ? 'FAIL' : 'PASS'} — checked`).join('\n')
const verdict = (n, v = 'go', fail = '') => `<!-- ticket-review:v1 -->\n## Ticket #${n}\n### Verdict\n${v}\n### Rubric\n${RUBRIC(fail)}\n`
const verdictComment = (n, v = 'go', fail = '', user = BOT) => {
  const t = [{ number: n, title: `T${n}`, labels: ['type:feat'], body: 'Rule: x. Test: y.' }]
  const d = decide(t, verdict(n, v, fail), { subject: String(n) })
  assert.equal(d.ok, true, String(d.errors))
  return { body: renderComment(d, { subject: String(n) }), user }
}

// ── T1: the ticket's cases ──
// covers: T1
test('T1 (1) a chat ticket under an epic with no verdict → review', () => {
  assert.equal(gateDecision({ ticket: ticket(), parent: EPIC }).action, 'review')
})
// covers: T1
test('T1 (2) the same with a bot go verdict for it → proceed; a person\'s copy of one does not count', () => {
  assert.deepEqual(gateDecision({ ticket: ticket(), parent: EPIC, epicComments: [verdictComment(21)] }), { action: 'proceed', reason: 'review-go' })
  assert.equal(gateDecision({ ticket: ticket(), parent: EPIC, epicComments: [verdictComment(21, 'go', '', PMCP)] }).action, 'review')
  // a later no-go overrides an earlier go
  assert.equal(gateDecision({ ticket: ticket(), parent: EPIC, epicComments: [verdictComment(21), verdictComment(21, 'no-go', '3')] }).action, 'review')
  // another ticket's go does not count for this one
  assert.equal(gateDecision({ ticket: ticket(), parent: EPIC, epicComments: [verdictComment(22)] }).action, 'review')
})
// covers: T1
test('T1 (4) no parent, or a parent without epic → proceed (today\'s path)', () => {
  assert.equal(gateDecision({ ticket: ticket(), parent: null }).action, 'proceed')
  assert.equal(gateDecision({ ticket: ticket(), parent: { number: 20, labels: ['type:feat'] } }).action, 'proceed')
})
// covers: T1
test('T1 (6) epic on the ticket → proceed; work-this on an epic starts no child review', () => {
  assert.deepEqual(gateDecision({ ticket: ticket({ labels: ['epic', 'work-this'] }), parent: EPIC }), { action: 'proceed', reason: 'is-epic' })
  assert.deepEqual(gateDecision({ ticket: ticket({ labels: ['epic', 'work-this'] }), parent: null }), { action: 'proceed', reason: 'is-epic' })
})
// covers: T1
test('T1 rules 1 and 3: a bot actor that may not drive the pipeline, and plan:approved, keep today\'s road', () => {
  assert.equal(gateDecision({ ticket: ticket(), parent: EPIC, actorAllowed: false }).action, 'proceed')
  assert.equal(gateDecision({ ticket: ticket({ labels: ['work-this', 'plan:approved'] }), parent: EPIC }).action, 'proceed')
})

// ── T2: who wrote the ticket ──
// covers: T2
test('T2 a split child (block + harness bot) → proceed, with or without a verdict, any depth', () => {
  const split = ticket({ body: `Rule: x.\n${BLOCK}`, author: BOT })
  assert.equal(pipelineMade(split), true)
  assert.equal(gateDecision({ ticket: split, parent: EPIC, epicComments: [verdictComment(21)] }).action, 'proceed')
  assert.deepEqual(gateDecision({ ticket: split, parent: EPIC }), { action: 'proceed', reason: 'pipeline-made' })
  const second = ticket({ body: 'Rule: x.\n<!-- pipeline: epic=4093 depth=2 dispatch=work-this -->', author: BOT })
  assert.equal(gateDecision({ ticket: second, parent: { number: 4093, labels: ['epic'] } }).action, 'proceed')
})
// covers: T2
test('T2 a #4394-shaped ticket (block copied by a person, no verdict) → review; #4415-shaped (with a bot go) → proceed', () => {
  const copied = ticket({ body: `Rule: x.\n${BLOCK}`, author: PMCP })
  assert.equal(pipelineMade(copied), false)
  assert.equal(gateDecision({ ticket: copied, parent: EPIC }).action, 'review')
  assert.equal(gateDecision({ ticket: copied, parent: EPIC, epicComments: [verdictComment(21)] }).action, 'proceed')
  // a bot author without a block is not pipeline-made either
  assert.equal(pipelineMade(ticket({ author: BOT })), false)
})

// ── T4: labelled twice → one review ──
// covers: T4
test('T4 a review running for this ticket → skip; a finished one does not stop it; work-this gone → skip', () => {
  const running = [{ display_title: 'ticket-review #20 · 21', status: 'in_progress' }]
  assert.deepEqual(gateDecision({ ticket: ticket(), parent: EPIC, runs: running }), { action: 'skip', reason: 'review-running' })
  assert.equal(gateDecision({ ticket: ticket(), parent: EPIC, runs: [{ display_title: 'ticket-review #20 · 21', status: 'completed' }] }).action, 'review')
  assert.equal(gateDecision({ ticket: ticket(), parent: EPIC, runs: [{ display_title: 'ticket-review #20 · 22', status: 'queued' }] }).action, 'review')
  assert.equal(gateDecision({ ticket: ticket(), parent: EPIC, runs: [{ display_title: 'ticket-review #20', status: 'queued' }] }).action, 'review')
  assert.deepEqual(gateDecision({ ticket: ticket({ labels: ['type:feat'] }), parent: EPIC }), { action: 'skip', reason: 'no-trigger-label' })
})

// A fake `gh` on PATH: answers from a state file, logs every call, and answers 404 to a DELETE of a
// label that was already removed (the once-only claim).
const FAKE_GH = `#!/usr/bin/env node
const fs = require('fs'); const path = require('path')
const dir = process.env.FAKE_GH_DIR; const st = JSON.parse(fs.readFileSync(path.join(dir, 'state.json'), 'utf8'))
const args = process.argv.slice(2); const s = args.join(' ')
fs.appendFileSync(path.join(dir, 'calls.log'), JSON.stringify(args) + '\\n')
const save = () => fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify(st))
const line = (o) => process.stdout.write(JSON.stringify(o) + '\\n')
if (s.includes('-X DELETE') && s.includes('/labels/work-this')) {
  if (st.removed) { process.stderr.write('gh: Label does not exist (HTTP 404)\\n'); process.exit(1) }
  st.removed = true; save(); process.exit(0)
}
if (/issues\\/\\d+\\/parent/.test(s)) { if (!st.parent) { process.stderr.write('gh: No parent issue found (HTTP 404)\\n'); process.exit(1) } line(st.parent); process.exit(0) }
if (/issues\\/\\d+\\/comments/.test(s) && args[0] === 'api') { for (const c of st.comments) line(c); process.exit(0) }
if (s.includes('actions/workflows/ticket-review.yml/runs')) { for (const r of st.runs) line(r); process.exit(0) }
if (/^api repos\\/[^ ]+\\/issues\\/\\d+ /.test(s)) { line(st.ticket); process.exit(0) }
if (args[0] === 'workflow' || args[0] === 'issue') process.exit(0)
process.stderr.write('fake gh: unexpected ' + s + '\\n'); process.exit(1)
`

function fakeWorld(state) {
  const dir = mkdtempSync(join(tmpdir(), 'trg-'))
  const bin = join(dir, 'bin'); mkdirSync(bin)
  writeFileSync(join(bin, 'gh'), FAKE_GH); chmodSync(join(bin, 'gh'), 0o755)
  writeFileSync(join(dir, 'state.json'), JSON.stringify({ removed: false, comments: [], runs: [], ...state }))
  const out = join(dir, 'out.txt'); writeFileSync(out, '')
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, FAKE_GH_DIR: dir, GITHUB_OUTPUT: out,
    GITHUB_REPOSITORY: 'o/r', GH_TOKEN: 'x', HANDOFF_FALLBACK_TOKEN: 'y', ACTOR: 'pmcp' }
  const run = (n = '21') => execFileSync('node', [new URL('./ticket-review-gate.mjs', import.meta.url).pathname, n], { env, encoding: 'utf8' })
  const calls = () => (existsSync(join(dir, 'calls.log')) ? readFileSync(join(dir, 'calls.log'), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [])
  return { run, calls, output: () => readFileSync(out, 'utf8') }
}
const REST_TICKET = { number: 21, body: 'Rule: x. Test: y.', labels: ['type:feat', 'work-this'], user: PMCP }

// covers: T4
test('T4 the CLI run twice for the same ticket → exactly one ticket-review dispatch and one ticket note', () => {
  const w = fakeWorld({ ticket: REST_TICKET, parent: EPIC })
  assert.match(w.run(), /review \(no-review-go\)/)
  assert.match(w.run(), /skip \(claimed-by-another-run\)/)
  const calls = w.calls()
  const dispatches = calls.filter((a) => a[0] === 'workflow' && a[1] === 'run')
  assert.equal(dispatches.length, 1)
  assert.deepEqual(dispatches[0], ['workflow', 'run', 'ticket-review.yml', '--repo', 'o/r', '-f', 'epic=20', '-f', 'subject=21'])
  const notes = calls.filter((a) => a[0] === 'issue' && a[1] === 'comment')
  assert.equal(notes.length, 1)
  assert.equal(notes[0][2], '21')
  assert.match(notes[0].at(-1), /Ticket review first \(epic #20\)/)
  assert.doesNotMatch(notes[0].at(-1), /@\w/)
  assert.equal(w.output(), 'held=true\nheld=true\n')
})
// covers: T4
test('CLI: a ticket with no parent proceeds — no claim, no dispatch, no held output', () => {
  const w = fakeWorld({ ticket: REST_TICKET, parent: null })
  assert.match(w.run(), /proceed \(no-parent-epic\)/)
  assert.ok(!w.calls().some((a) => a.includes('DELETE') || a[0] === 'workflow'))
  assert.equal(w.output(), '')
})
// covers: T4
test('CLI: a review already running → skip and take work-this off, so the go re-add fires a fresh event', () => {
  const w = fakeWorld({ ticket: REST_TICKET, parent: EPIC, runs: [{ display_title: 'ticket-review #20 · 21', status: 'in_progress' }] })
  assert.match(w.run(), /skip \(review-running\)/)
  const calls = w.calls()
  assert.equal(calls.filter((a) => a.includes('DELETE')).length, 1)
  assert.ok(!calls.some((a) => a[0] === 'workflow'))
  assert.equal(w.output(), 'held=true\n')
})

// ── T8: the gate's own release ──
// The gate took work-this off before the review, so a held ticket carries no trigger label.
const heldTicket = (body) => ticket({ labels: ['type:feat'], body })
const goFixtures = [
  { name: '(a) blocker closed', ticket: heldTicket('Blocked-by: #12'), blockerStates: { 12: 'closed' } },
  { name: '(b) blocker open', ticket: heldTicket('Blocked-by: #12'), blockerStates: { 12: 'open' } },
  { name: '(b) blocker state unknown', ticket: heldTicket('Blocked-by: #12, #13'), blockerStates: { 12: 'closed' } },
  { name: '(c) no Blocked-by', ticket: ticket({ labels: ['type:feat'] }), blockerStates: {} },
  { name: '(e) already started', ticket: ticket({ labels: ['status:in-progress'] }), blockerStates: {} },
]
// covers: T8
test('T8 (a)/(c) go, unblocked → remove-then-add work-this on the ticket', () => {
  const pair = [{ kind: 'unlabel', issue: 21, label: 'work-this' }, { kind: 'label', issue: 21, label: 'work-this' }]
  assert.deepEqual(gateRelease({ ...goFixtures[0], verdict: 'go' }), pair)
  assert.deepEqual(gateRelease({ ...goFixtures[3], verdict: 'go' }), pair)
})
// covers: T8
test('T8 (b) go, a blocker still open → one comment on the ticket naming it, no label', () => {
  const lines = gateRelease({ ...goFixtures[1], verdict: 'go' })
  assert.equal(lines.length, 1)
  assert.equal(lines[0].kind, 'comment'); assert.equal(lines[0].issue, 21)
  assert.match(lines[0].text, /^<!-- pipeline-note -->/)
  assert.match(lines[0].text, /approved; waits for #12 — it starts by itself when it closes/)
  assert.doesNotMatch(lines[0].text, /@\w/)
  assert.match(gateRelease({ ...goFixtures[2], verdict: 'go' })[0].text, /waits for #13 — /)
})
// covers: T8
test('T8 (d) no-go → no release lines; through reviewActions on a non-rolling epic → the rewrite round, no label', () => {
  assert.deepEqual(gateRelease({ ...goFixtures[0], verdict: 'no-go' }), [])
  const t = { number: 11, title: 'T11', state: 'open', labels: ['type:feat'], body: 'Rule: x. Test: y.' }
  const d = decide([t], verdict(11, 'no-go', '3'), { subject: '11' })
  const lines = reviewActions({ epic: 10, subject: '11', labels: ['epic'], decision: d, comments: [], tickets: [t], subIssues: [t] })
  assert.ok(!lines.some((l) => l.kind === 'label'))
  assert.deepEqual(lines.filter((l) => l.kind === 'dispatch'), [{ kind: 'dispatch', issue: 10, workflow: 'ticket-revise.yml', inputs: { epic: '10', subject: '11' } }])
})
// covers: T8
test('T8 (e) go on a ticket already started → an "already started" comment, no label', () => {
  const lines = gateRelease({ ...goFixtures[4], verdict: 'go' })
  assert.deepEqual(lines.map((l) => l.kind), ['comment'])
  assert.match(lines[0].text, /already started/)
})
// covers: T8
test('T8 a go never ends silent: every go re-adds work-this on the ticket or comments on it', () => {
  for (const f of goFixtures) {
    const lines = gateRelease({ ...f, verdict: 'go' })
    const ok = lines.some((l) => l.issue === 21 && ((l.kind === 'label' && l.label === 'work-this') || l.kind === 'comment'))
    assert.ok(ok, f.name)
  }
  // the same through reviewActions with a blocked go on a non-rolling epic
  const t = { number: 11, title: 'T11', state: 'open', labels: ['type:feat'], body: 'Rule: x. Test: y.\nBlocked-by: #12' }
  const d = decide([t], verdict(11), { subject: '11' })
  const lines = reviewActions({ epic: 10, subject: '11', labels: ['epic'], decision: d, comments: [], tickets: [t], subIssues: [t], blockerStates: { 12: 'open' } })
  assert.ok(lines.some((l) => l.kind === 'comment' && l.issue === 11 && /waits for #12/.test(l.text)))
  assert.ok(!lines.some((l) => l.kind === 'label'))
})

// ── T9: then the blocker closes ──
function waveWorld({ found = [], issues = {} } = {}) {
  const calls = { addLabels: [], comments: [] }
  const github = {
    paginate: async (fn) => (fn === github.rest.search.issuesAndPullRequests ? found : []),
    rest: {
      search: { issuesAndPullRequests: () => {} },
      checks: { listForRef: () => {} },
      issues: {
        get: async ({ issue_number }) => ({ data: issues[issue_number] }),
        addLabels: async (a) => calls.addLabels.push(a),
        createComment: async (a) => calls.comments.push(a),
        update: async () => {}, listComments: () => {}, listEventsForTimeline: () => {},
      },
      pulls: { get: async () => ({ data: {} }) },
    },
  }
  return { github, core: { info: () => {}, warning: () => {} }, context: { repo: { owner: 'o', repo: 'r' }, payload: {} }, calls }
}
// covers: T9
test('T9 the held ticket is released by the real wave release when #12 closes, and the gate then lets it build', async () => {
  const w = waveWorld({ found: [{ number: 11, body: 'Rule: x.\nBlocked-by: #12', labels: [] }], issues: { 12: { state: 'closed' } } })
  await releaseReady(w, { onlyBlockedBy: 12 })
  assert.deepEqual(w.calls.addLabels.map((a) => [a.issue_number, a.labels]), [[11, ['delegate']]])
  const w2 = waveWorld({ found: [{ number: 11, body: 'Rule: x.\nBlocked-by: #12\n<!-- pipeline: dispatch=work-this -->', labels: [] }], issues: { 12: { state: 'closed' } } })
  await releaseReady(w2, { onlyBlockedBy: 12 })
  assert.deepEqual(w2.calls.addLabels.map((a) => a.labels), [['work-this']])
  // the decomposer (or the release) re-adds work-this as the bot; the go verdict on the epic lets it through
  const held = { number: 11, labels: ['work-this'], body: 'Rule: x.\nBlocked-by: #12', author: PMCP }
  const d = gateDecision({ ticket: held, parent: { number: 10, labels: ['epic'] }, epicComments: [verdictComment(11)], actorAllowed: true })
  assert.deepEqual(d, { action: 'proceed', reason: 'review-go' })
})

// ── T3: wiring ──
const wf = (n) => readFileSync(new URL(`../.github/workflows/${n}`, import.meta.url), 'utf8')
// covers: T3
test('T3 label-router runs the gate before Dispatch; ticket-review posts ticket comments and no longer strips tickets:approved', () => {
  const r = wf('label-router.yml')
  const gate = r.indexOf('- name: Ticket review gate'); const disp = r.indexOf('- name: Dispatch')
  assert.ok(gate > 0 && gate < disp, 'the gate step runs before Dispatch')
  const step = r.slice(gate, disp)
  assert.match(step, /id: gate\n/)
  assert.match(step, /if: env\.LABEL == 'work-this'/)
  assert.match(step, /run: node scripts\/ticket-review-gate\.mjs "\$ISSUE"/)
  assert.match(r.slice(disp), /^- name: Dispatch\n\s+if: steps\.gate\.outputs\.held != 'true'\n/)
  const t = wf('ticket-review.yml')
  assert.ok(!t.includes('--remove-label "tickets:approved"'), 'the tickets:approved removal moved into legacyActions')
  assert.match(t, /comment\) gh issue comment "\$N" --body "\$\(jq -r \.text <<<"\$A"\)" ;;/)
})
