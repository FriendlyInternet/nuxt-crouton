import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  tallyCi, stamp, failureList, failureExcerpts, logTailBlock, fixBotFailures, stageBar, epicCard,
  prSourceSha, epicFromIssue, signoffPingBody, withheldBody,
} from './pr-status.mjs'
import { normalizeSteps, renderSteps, stepSummary, HARNESS_BOT, ROLLING_LABEL } from './epic-steps.mjs'

// ── #4316: the card counts steps for a rolling epic and names dropped tickets ──
const stepList = (n, tickets = {}) => ({
  body: renderSteps(normalizeSteps(Array.from({ length: n }, (_, i) => ({ title: `S${i}`, goal: 'g', proves: 'p', ticket: tickets[i] })))),
  user: { login: HARNESS_BOT, type: 'Bot' },
})
const kid = (number, state, reason = null, step = null) => ({ number, state, state_reason: reason, body: step === null ? '' : `<!-- pipeline: epic=9 step=${step} -->` })
const cardFor = ({ labels = [ROLLING_LABEL], comments, subs }) =>
  epicCard({ title: 'T', epicBlocked: false, subs, childLines: [], now: 'now', summary: stepSummary({ labels, comments, subIssues: subs }) }).body

// covers: T1
test('#4316 case 1: 4 steps, only step 0 built → "1 of 4 steps built", never Assembled', () => {
  const body = cardFor({ comments: [stepList(4, { 0: 11 })], subs: [kid(11, 'closed', 'completed', 0)] })
  assert.ok(body.includes('## 🔨 Building — T  (1 of 4 steps built)'), body)
  assert.ok(body.includes('3 of 4 steps not built yet'))
  assert.ok(!body.includes('Assembled'))
})

// covers: T2
test('#4316 case 2: built / dropped / built → Assembled "2 built, 1 dropped", not "all children merged"', () => {
  const subs = [kid(11, 'closed', 'completed', 0), kid(12, 'closed', 'not_planned', 1), kid(13, 'closed', 'completed', 2)]
  const body = cardFor({ comments: [stepList(3)], subs })
  assert.ok(body.includes('## ✅ Assembled — T  (2 built, 1 dropped)'), body)
  assert.ok(body.includes('dropped 1 (not planned): #12'))
  assert.ok(!body.includes('all children merged'))
})

// covers: T5
test('#4316 case 5: no step list, 3 closed children with 1 not planned → Assembled (3/3) with the counts line', () => {
  const subs = [kid(11, 'closed', 'completed'), kid(12, 'closed', 'not_planned'), kid(13, 'closed', 'completed')]
  const body = cardFor({ labels: [], comments: [], subs })
  assert.ok(body.includes('## ✅ Assembled — T  (3/3)'))
  assert.ok(body.includes('_now: all children closed — 2 merged, 1 not planned: #12 —'))
  assert.ok(!body.includes('all children merged'))
})

// covers: T6
test('#4316 case 6: an unreadable step list → Building (step list unreadable), never Assembled', () => {
  const broken = { body: '<!-- epic-steps:v1 -->\n```json\n[nope\n```', user: { login: HARNESS_BOT, type: 'Bot' } }
  const body = cardFor({ comments: [broken], subs: [kid(11, 'closed', 'completed')] })
  assert.ok(body.includes('## 🔨 Building — T  (step list unreadable)'))
  assert.ok(!body.includes('Assembled'))
})

const done = (name, conclusion, extra = {}) => ({ name, status: 'completed', conclusion, id: 1, check_suite: { id: 9 }, ...extra })

test('tallyCi: failure > pending > cancelled > passing, zero → queued', () => {
  assert.equal(tallyCi({}).word, 'queued')
  assert.equal(tallyCi({ checkRuns: [done('a', 'success')] }).word, 'passing')
  assert.equal(tallyCi({ checkRuns: [done('a', 'success'), done('b', 'cancelled')] }).word, 'incomplete')
  assert.equal(tallyCi({ checkRuns: [done('a', 'cancelled'), { name: 'p', status: 'queued' }] }).word, 'running')
  const f = tallyCi({ checkRuns: [done('a', 'cancelled'), { name: 'p', status: 'queued' }, done('x', 'timed_out')] })
  assert.equal(f.word, 'failing')
  assert.deepEqual(f.failing.map(x => x.name), ['x'])
  assert.equal(f.failing[0].suite, 9)
})

test('tallyCi: commit statuses count; a failed status is named without annotations', () => {
  const st = tallyCi({ statuses: [{ state: 'success' }, { state: 'pending' }, { state: 'error', context: 'deploy' }] })
  assert.deepEqual([st.success, st.pending, st.failure, st.total], [1, 1, 1, 3])
  assert.deepEqual(st.failing, [{ name: 'deploy' }])
})

test('stamp formats to minute precision', () => {
  assert.equal(stamp(new Date('2026-01-02T03:04:59Z')), '2026-01-02 03:04Z')
})

test('failureList: 5 named + "+N more", or the checks-tab fallback', () => {
  const many = Array.from({ length: 7 }, (_, i) => ({ name: `c${i}` }))
  const r = failureList(many)
  assert.equal(r.names.length, 5)
  assert.equal(r.list, '`c0`, `c1`, `c2`, `c3`, `c4` +2 more')
  assert.equal(failureList([]).list, 'see the checks tab')
})

test('failureExcerpts: failures only, 400-char cut, context fallback labelled, empty → ""', () => {
  assert.equal(failureExcerpts([]), '')
  const out = failureExcerpts([{ name: 'A', annotations: [{ annotation_level: 'notice', message: 'n' }, { annotation_level: 'failure', message: 'z'.repeat(450) }] }])
  assert.ok(out.includes(`A: ${'z'.repeat(400)}\n`) && !out.includes('z'.repeat(401)) && !out.includes('A: n'))
  assert.ok(failureExcerpts([{ name: 'B', annotations: [{ annotation_level: 'warning', message: 'w' }] }]).includes('B (no error annotation — showing context): w'))
})

test('logTailBlock: neutralises triple backticks, honours the byte budget, skips empty logs', () => {
  assert.equal(logTailBlock({ name: 'x', raw: '', budget: 20000 }), null)
  const r = logTailBlock({ name: 'x', raw: 'a ```b``` c', budget: 20000 })
  assert.ok(r.block.includes("a '''b''' c") && r.block.includes('<summary>log tail — x</summary>'))
  const big = logTailBlock({ name: 'y', raw: 'line\n'.repeat(5000), budget: 100 })
  assert.ok(big.used <= 100 && big.block.includes('(truncated)'))
  // 3 checks against the 20000-byte budget never exceed it
  let budget = 20000, total = 0
  for (const n of ['a', 'b', 'c']) { const t = logTailBlock({ name: n, raw: 'x'.repeat(30000).replace(/(.{100})/g, '$1\n'), budget }); if (t) { budget -= t.used; total += t.used } }
  assert.ok(total <= 20000)
})

test('logTailBlock: a test failure is quoted first as Stopped at: (#3666)', () => {
  const raw = readFileSync(new URL('./__fixtures__/ci-logs/pr3522-node-checks.txt', import.meta.url), 'utf8')
  const r = logTailBlock({ name: 'Node checks', raw, budget: 20000 })
  const cause = "not ok 567 - every label description fits GitHub's 100-character limit"
  const stop = r.block.indexOf('Stopped at:')
  const body = r.block.slice(stop)
  assert.ok(stop > -1 && body.startsWith(`Stopped at:\n\`\`\`\n`) && body.indexOf(cause) < body.indexOf('```\n```\n'))
  assert.ok(r.block.includes(`<summary>log tail — Node checks — stopped at: not ok 567 - every label description fits GitHub's 100-character limit</summary>`), r.block.slice(0, 300))
  // the Stopped-at fence closes before the tail's fence opens
  assert.ok(r.block.includes('```\n```\n'))
  assert.ok(r.used <= 4096)
})

test('logTailBlock: no cause line → byte-identical to the plain tail', () => {
  const r = logTailBlock({ name: 'x', raw: 'line\n'.repeat(50), budget: 20000 })
  assert.deepEqual(r, { used: 249, block: `\n\n<details><summary>log tail — x</summary>\n\n\`\`\`\n${'line\n'.repeat(49)}line\n\`\`\`\n</details>` })
  assert.doesNotMatch(r.block, /Stopped at:/)
})

test('logTailBlock: the summary cause is HTML-escaped', () => {
  const r = logTailBlock({ name: 'T', raw: '##[error]x.ts(1,1): error TS2322: Ref<string> & y\n', budget: 20000 })
  const summary = r.block.match(/<summary>(.*)<\/summary>/)[1]
  assert.ok(summary.includes('Ref&lt;string&gt; &amp; y'), summary)
  assert.ok(!summary.includes('<string>'))
})

test('fixBotFailures maps a check to its workflow run by suite id', () => {
  const r = fixBotFailures([{ suite: 5, conclusion: 'failure' }, { name: 'status only' }], [{ check_suite_id: 5, name: 'CI', conclusion: 'failure' }])
  assert.equal(r[0].workflow, 'CI')
  assert.deepEqual(r[1], { workflow: null, conclusion: null })
})

test('stageBar: 0 / partial / all closed', () => {
  assert.equal(stageBar(0, 0), '**sign-off** ◀ → build → assemble → review')
  assert.equal(stageBar(3, 1), 'sign-off ✓ → **build** ◀ → assemble → review')
  assert.equal(stageBar(3, 3), 'sign-off ✓ → build ✓ → **assemble** ◀ → review')
})

test('epicCard: headline per state, and only a blocked empty epic wants the sign-off check', () => {
  const base = { title: 'T', childLines: [], now: 'N' }
  const a = epicCard({ ...base, epicBlocked: true, subs: [] })
  assert.ok(a.body.includes('## 🎨 Awaiting your sign-off — T') && a.needsSignoffCheck)
  const b = epicCard({ ...base, epicBlocked: false, subs: [] })
  assert.ok(b.body.includes('## ⏳ Decomposing — T') && !b.needsSignoffCheck)
  const c = epicCard({ ...base, epicBlocked: true, subs: [{ state: 'closed' }, { state: 'open' }] })
  assert.ok(c.body.includes('## 🔨 Building — T  (1/2)') && !c.needsSignoffCheck)
  assert.ok(epicCard({ ...base, epicBlocked: false, subs: [{ state: 'closed' }] }).body.includes('## ✅ Assembled — T  (1/1)'))
})

test('prSourceSha prefers workflow_run, then check_suite, then status sha', () => {
  assert.equal(prSourceSha({ workflow_run: { head_sha: 'a' }, check_suite: { head_sha: 'b' }, sha: 'c' }), 'a')
  assert.equal(prSourceSha({ check_suite: { head_sha: 'b' }, sha: 'c' }), 'b')
  assert.equal(prSourceSha({ sha: 'c' }), 'c')
  assert.equal(prSourceSha({}), undefined)
})

test('epicFromIssue: itself if it has sub-issues, else the epic=N marker, else null', () => {
  assert.equal(epicFromIssue({ hasSubs: true, body: 'epic=9', number: 4 }), 4)
  assert.equal(epicFromIssue({ hasSubs: false, body: '<!-- pipeline: epic=9 -->', number: 4 }), 9)
  assert.equal(epicFromIssue({ hasSubs: false, body: null, number: 4 }), null)
})

test('sign-off bodies carry their one-shot markers', () => {
  assert.ok(signoffPingBody({ epicNumber: 3, owner: 'o', title: 'T' }).startsWith('<!-- signoff-ping:3 -->'))
  assert.ok(withheldBody({ epicNumber: 3, prNumber: 8, title: 'T' }).startsWith('<!-- signoff-withheld-nocapture:3 -->'))
})

// 7 of 16 red notes on 18–19 Nov said only "<check>: Process completed with exit code 1." under
// "what failed" (PRs #4148, #4149, #4150, #4152, #4203, #4144). That line is in every failed job
// and names nothing; the log-tail block below it carries the real cause.
test('failureExcerpts: the runner\'s "exit code" line alone is not "what failed"', () => {
  const exit = { annotation_level: 'failure', message: 'Process completed with exit code 1.' }
  assert.equal(failureExcerpts([{ name: 'Node checks', annotations: [exit] }]), '')
  const out = failureExcerpts([{ name: 'frontend-review', annotations: [exit, { annotation_level: 'failure', message: 'frontend-review did not run — failing closed.' }] }])
  assert.ok(out.includes('frontend-review: frontend-review did not run — failing closed.'))
  assert.ok(!out.includes('exit code 1'))
})
