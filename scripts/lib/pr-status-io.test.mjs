// Behaviour pins for the status.yml `pr-comment` job (#3617). Runs the REAL entry point
// (runStatus) against a fake `github`, and asserts every comment written, byte for byte
// (timestamp frozen). Set PIN_INLINE=<path to an old status.yml> to run the same fixtures against
// the pre-move inline script — that is how "no behaviour change" was checked.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { runStatus } from './pr-status-io.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const STATUS_YML = path.join(ROOT, '.github/workflows/status.yml')
const RealDate = Date
const FROZEN = '2026-01-02T03:04:05.000Z'
const NOW = '2026-01-02 03:04Z'

function freezeDate() {
  globalThis.Date = class extends RealDate {
    constructor(...a) { a.length ? super(...a) : super(FROZEN) }
  }
  return () => { globalThis.Date = RealDate }
}

const run = (name, conclusion = 'success', extra = {}) =>
  ({ id: extra.id ?? Math.floor(Math.random() * 1e6), name, status: conclusion ? 'completed' : 'in_progress', conclusion, check_suite: { id: extra.suite ?? 1 } })

function makePr(over = {}) {
  return {
    number: 7, state: 'open', html_url: 'https://github.com/o/r/pull/7', labels: [],
    head: { ref: 'work-1958', sha: 'abc1234def' }, base: { ref: 'main', sha: 'base0' },
    created_at: '2026-01-01T00:00:00Z', ...over,
  }
}

function fake(w = {}) {
  const comments = new Map() // issue -> [{id, body}]
  let nextId = 1
  const calls = { create: [], update: [] }
  const list = n => { if (!comments.has(n)) comments.set(n, []); return comments.get(n) }
  for (const [n, bodies] of Object.entries(w.comments || {})) for (const body of bodies) list(+n).push({ id: nextId++, body })
  const prs = w.prs || {}
  const rest = {
    issues: {
      listComments: Symbol('listComments'),
      createComment: async ({ issue_number, body }) => { calls.create.push({ issue_number, body }); list(issue_number).push({ id: nextId++, body }) },
      updateComment: async ({ comment_id, body }) => {
        calls.update.push({ comment_id, body })
        for (const arr of comments.values()) { const c = arr.find(x => x.id === comment_id); if (c) c.body = body }
      },
      get: async ({ issue_number }) => ({ data: (w.issues || {})[issue_number] || { title: 'Epic: X', labels: [] } }),
    },
    checks: {
      listForRef: Symbol('listForRef'),
      listAnnotations: async ({ check_run_id }) => ({ data: (w.annotations || {})[check_run_id] || [] }),
    },
    actions: {
      listWorkflowRunsForRepo: Symbol('listWorkflowRunsForRepo'),
      downloadJobLogsForWorkflowRun: async ({ job_id }) => {
        if (!(w.logs && job_id in w.logs)) throw new Error('no log')
        return { data: w.logs[job_id] }
      },
    },
    repos: {
      getCombinedStatusForRef: async () => ({ data: { statuses: w.statuses || [] } }),
      listPullRequestsAssociatedWithCommit: Symbol('assoc'),
      compareCommits: async () => ({ data: { merge_base_commit: { sha: 'mb' } } }),
      getContent: async () => ({ data: '' }),
    },
    pulls: {
      get: async ({ pull_number }) => ({ data: prs[pull_number] }),
      list: Symbol('pullsList'),
      listFiles: Symbol('listFiles'),
    },
  }
  const github = {
    rest,
    async paginate(fn, p) {
      if (fn === rest.issues.listComments) return [...list(p.issue_number)]
      if (fn === rest.checks.listForRef) return (w.checks || [])
      if (fn === rest.actions.listWorkflowRunsForRepo) return (w.wfRuns || [])
      if (fn === rest.repos.listPullRequestsAssociatedWithCommit) return (w.assoc || [])
      if (fn === rest.pulls.list) return (w.workPrs || {})[p.head.split(':work-')[1]] || []
      if (fn === rest.pulls.listFiles) return (w.files || [])
      if (typeof fn === 'string' && fn.includes('sub_issues')) return (w.subs || {})[p.issue_number] || []
      throw new Error('unexpected paginate ' + String(fn))
    },
  }
  const core = { info() {}, warning() {} }
  return { github, core, calls, comments }
}

const ctx = (eventName, payload) => ({ eventName, repo: { owner: 'o', repo: 'r' }, payload })

async function go(f, eventName, payload) {
  const restore = freezeDate()
  try {
    const impl = process.env.PIN_INLINE
    if (impl) {
      const L = fs.readFileSync(impl, 'utf8').split('\n')
      const si = L.findIndex(l => l === '          script: |')
      const ei = L.findIndex((l, i) => i > si && /^# ── board job/.test(l))
      const body = L.slice(si + 1, ei).map(l => l.slice(12)).join('\n')
      const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
      process.env.GITHUB_WORKSPACE = ROOT
      process.env.OWNER_LOGIN = 'pmcp'
      await new AsyncFunction('github', 'context', 'core', body)(f.github, ctx(eventName, payload), f.core)
    } else {
      await runStatus({ github: f.github, context: ctx(eventName, payload), core: f.core, owner: 'pmcp' })
    }
  } finally { restore() }
}

const prEvent = pr => ['pull_request', { action: 'synchronize', pull_request: pr }]

const failingChecks = () => [
  ...Array.from({ length: 46 }, (_, i) => run(`ok-${i}`)),
  ...Array.from({ length: 4 }, (_, i) => run(`pending-${i}`, null)),
  run('Fallow Audit', 'failure', { id: 901, suite: 5 }),
  run('Lint', 'failure', { id: 902, suite: 5 }),
]

test('a: failing pipeline PR → sticky + one red ping', async () => {
  const pr = makePr({ labels: [{ name: 'ci-fix-attempts:1' }] })
  const f = fake({ prs: { 7: pr }, checks: failingChecks(), wfRuns: [{ check_suite_id: 5, name: 'CI', conclusion: 'failure' }],
    annotations: { 901: [{ annotation_level: 'failure', message: 'dead export foo' }] },
    logs: { 901: 'line1\nline2 ```x```' } })
  await go(f, ...prEvent(pr))
  const sticky = f.calls.create.find(c => c.body.startsWith('<!-- crouton-pipeline-status -->'))
  assert.equal(sticky.body,
    '<!-- crouton-pipeline-status -->\n### ❌ CI failing\n' +
    '46/52 checks passed · 4 running · 2 failing. · 🔧 auto-fix ×1\n\n' +
    `<sub>🤖 agent pipeline (#337) · \`work-1958\` → \`main\` · <a href="https://github.com/o/r/pull/7/checks">checks</a> · updated ${NOW}</sub>`)
  const pings = f.calls.create.filter(c => c.body.includes('<!-- ci-fail-ping:abc1234def -->'))
  assert.equal(pings.length, 1)
  assert.match(pings[0].body, /🔴/)
  assert.match(pings[0].body, /`Fallow Audit`, `Lint`/)
  assert.match(pings[0].body, /<summary>what failed<\/summary>\n\n```\nFallow Audit: dead export foo\n```/)
  assert.match(pings[0].body, /<summary>log tail — Fallow Audit[^<]*<\/summary>/)
  assert.ok(pings[0].body.includes("line2 '''x'''"), 'triple backticks in logs are neutralised')
  assert.match(pings[0].body, /\[Checks\]\(https:\/\/github.com\/o\/r\/pull\/7\/checks\) · `work-1958` → `main`\./)
  assert.match(pings[0].body, /<sub>🤖 agent pipeline \(CI\) · failure notify \(#1815\/#1909\/#3373\)<\/sub>$/)
  f.pings = pings[0].body
  // b: same SHA again, nothing new → no create and no update of the ping
  const before = { c: f.calls.create.length, u: f.calls.update.length }
  await go(f, ...prEvent(pr))
  assert.equal(f.calls.create.length, before.c, 'no second create')
  const pingUpdates = f.calls.update.filter(u => u.body.includes('ci-fail-ping'))
  assert.equal(pingUpdates.length, 0, 'identical ping is not rewritten')
  assert.equal(f.calls.update.filter(u => u.body.startsWith('<!-- crouton-pipeline-status -->')).length, 1, 'sticky edited in place')
})

test('c: a ping that exists but now has more failures is UPDATED, never re-created (#2029)', async () => {
  const pr = makePr()
  const checks = [run('Lint', 'failure', { id: 902, suite: 5 })]
  const f = fake({ prs: { 7: pr }, checks, wfRuns: [{ check_suite_id: 5, name: 'CI', conclusion: 'failure' }] })
  await go(f, ...prEvent(pr))
  checks.push(run('Typecheck', 'failure', { id: 903, suite: 5 }))
  f.github.paginate = ((orig) => async (fn, p) => orig(fn, p))(f.github.paginate)
  const n = f.calls.create.filter(c => c.body.includes('ci-fail-ping')).length
  assert.equal(n, 1)
  await go(f, ...prEvent(pr))
  assert.equal(f.calls.create.filter(c => c.body.includes('ci-fail-ping')).length, 1)
  const upd = f.calls.update.filter(u => u.body.includes('ci-fail-ping'))
  assert.equal(upd.length, 1)
  assert.match(upd[0].body, /`Lint`, `Typecheck`/)
})

test('d: the CI Gate aggregate is named only when it is the only red check (#2710)', async () => {
  const pr = makePr()
  const only = fake({ prs: { 7: pr }, checks: [run('CI Gate', 'failure', { id: 1, suite: 5 })] })
  await go(only, ...prEvent(pr))
  const p1 = only.calls.create.find(c => c.body.includes('ci-fail-ping'))
  assert.ok(p1.body.includes('`CI Gate`'))
  assert.ok(!p1.body.includes('see the checks tab'))
  const both = fake({ prs: { 7: pr }, checks: [run('CI Gate', 'failure', { id: 1, suite: 5 }), run('Lint', 'failure', { id: 2, suite: 5 })] })
  await go(both, ...prEvent(pr))
  const p2 = both.calls.create.find(c => c.body.includes('ci-fail-ping'))
  assert.ok(p2.body.includes('`Lint`'))
  assert.ok(!p2.body.includes('`CI Gate`'))
})

test('e: passing / incomplete / queued verdicts, and none of them pings', async () => {
  const pr = makePr()
  const cases = [
    [[run('a'), run('b', 'skipped')], '### ✅ CI passing', '2/2 checks passed.'],
    [[run('a'), run('b', 'cancelled')], '### ⏹️ CI incomplete', '1/2 checks passed · 1 cancelled (bumped, not failed — re-run or push to refresh).'],
    [[], '### ⏳ CI queued', '0/0 checks passed.'],
    [[run('a'), run('b', null)], '### ⏳ CI running', '1/2 checks passed · 1 running.'],
  ]
  for (const [checks, head, line] of cases) {
    const f = fake({ prs: { 7: pr }, checks })
    await go(f, ...prEvent(pr))
    assert.equal(f.calls.create.length, 1, head)
    assert.ok(f.calls.create[0].body.includes(`${head}\n${line}`), f.calls.create[0].body)
  }
})

test('f: only failure-level annotations are quoted; context is labelled when there are none', async () => {
  const pr = makePr()
  const mk = annotations => fake({ prs: { 7: pr }, checks: [run('Lint', 'failure', { id: 902, suite: 5 })], annotations: { 902: annotations } })
  const a = mk([{ annotation_level: 'notice', message: 'node 20 deprecated' }, { annotation_level: 'failure', message: 'x'.repeat(500) }])
  await go(a, ...prEvent(pr))
  const body = a.calls.create.find(c => c.body.includes('ci-fail-ping')).body
  assert.ok(!body.includes('deprecated'))
  assert.ok(body.includes(`Lint: ${'x'.repeat(400)}\n`) && !body.includes('x'.repeat(401)), '400-char cut')
  const b = mk([{ annotation_level: 'notice', message: 'only context' }])
  await go(b, ...prEvent(pr))
  assert.ok(b.calls.create.find(c => c.body.includes('ci-fail-ping')).body.includes('Lint (no error annotation — showing context): only context'))
})

test('g/h: epic→main gets only a red note; a human branch gets nothing', async () => {
  const epic = makePr({ head: { ref: 'epic/12-x', sha: 'eee' }, base: { ref: 'main', sha: 'b' } })
  const green = fake({ prs: { 7: epic }, checks: [run('CI Gate')] })
  await go(green, ...prEvent(epic))
  assert.equal(green.calls.create.length + green.calls.update.length, 0)
  const red = fake({ prs: { 7: epic }, checks: [run('CI Gate', 'failure', { id: 4, suite: 5 })] })
  await go(red, ...prEvent(epic))
  assert.equal(red.calls.create.length, 1)
  assert.ok(red.calls.create[0].body.includes('<!-- ci-fail-ping:eee -->'))
  assert.ok(!red.calls.create.some(c => c.body.includes('crouton-pipeline-status')))
  const human = makePr({ head: { ref: 'feat/x', sha: 'h' } })
  const f = fake({ prs: { 7: human }, checks: [run('Lint', 'failure', { id: 5, suite: 5 })] })
  await go(f, ...prEvent(human))
  assert.equal(f.calls.create.length + f.calls.update.length, 0)
})

test('i: a child issue closing refreshes its epic card (stage bar, child lines)', async () => {
  const subs = [{ number: 21, title: 'one', state: 'closed', labels: [] }, { number: 22, title: 'two', state: 'closed', labels: [] },
    { number: 23, title: 'three', state: 'open', labels: [{ name: 'status:blocked' }] }]
  const f = fake({ subs: { 12: subs }, issues: { 12: { title: 'Epic: Thing', labels: [] } } })
  await go(f, 'issues', { action: 'closed', issue: { number: 22, body: '<!-- pipeline: epic=12 -->' } })
  assert.equal(f.calls.create.length, 1)
  assert.equal(f.calls.create[0].issue_number, 12)
  assert.equal(f.calls.create[0].body,
    '<!-- crouton-epic-rollup -->\n## 🔨 Building — Thing  (2/3)\n\n' +
    '`sign-off ✓ → **build** ◀ → assemble → review`\n\n' +
    '- ✅ #21 one\n- ✅ #22 two\n- ⏸️ #23 three — held — needs your reply\n\n' +
    '_now: 1 of 3 in flight — reply here or on a PR to steer_\n\n' +
    `<sub>🤖 agent pipeline · live status (#1838) · updated ${NOW}</sub>`)
})

test('j: sign-off hold pings once when the held PR is green; a visual PR with no capture is withheld', async () => {
  const issue = { number: 31, body: '<!-- pipeline: epic=30 -->', title: 'x' }
  const held = makePr({ number: 99, head: { ref: 'work-30', sha: 'hhh' } })
  const mkF = files => fake({
    issues: { 30: { title: 'Epic: Held', labels: [{ name: 'status:blocked' }] } },
    workPrs: { 30: [held] }, checks: [run('CI Gate')], prs: { 99: held }, files,
  })
  const f = mkF([{ filename: 'README.md', status: 'modified', patch: '@@ -1 +1 @@\n-a\n+b' }])
  await go(f, 'issues', { action: 'reopened', issue })
  const pings = f.calls.create.filter(c => c.body.includes('<!-- signoff-ping:30 -->'))
  assert.equal(pings.length, 1)
  assert.ok(pings[0].body.includes('🎨 **@pmcp — this needs your sign-off** (Held).'))
  await go(f, 'issues', { action: 'reopened', issue })
  assert.equal(f.calls.create.filter(c => c.body.includes('<!-- signoff-ping:30 -->')).length, 1, 'not pinged twice')
  // visual (a .vue template change) with no capture comment → withheld, no ping
  const v = mkF([{ filename: 'apps/a/app/components/X.vue', status: 'added', patch: '@@ -0,0 +1,3 @@\n+<template>\n+<div>hi</div>\n+</template>' }])
  await go(v, 'issues', { action: 'reopened', issue })
  assert.equal(v.calls.create.filter(c => c.body.includes('signoff-ping')).length, 0)
  const w = v.calls.create.find(c => c.body.includes('<!-- signoff-withheld-nocapture:30 -->'))
  assert.ok(w && w.body.includes('PR #99 changes a visual surface'))
})

test('k: a check event resolves PRs by head SHA and only updates the open ones', async () => {
  const open = makePr(), closed = makePr({ number: 8, state: 'closed' })
  const f = fake({ prs: { 7: open, 8: closed }, assoc: [{ number: 7 }, { number: 8 }], checks: [run('a')] })
  await go(f, 'workflow_run', { workflow_run: { head_sha: 'abc1234def' } })
  assert.equal(f.calls.create.length, 1)
  assert.equal(f.calls.create[0].issue_number, 7)
})

test('structural: the status.yml pr-comment step is thin glue that imports the module (#3617)', () => {
  const yml = fs.readFileSync(STATUS_YML, 'utf8')
  const L = yml.split('\n')
  const si = L.findIndex(l => l === '          script: |')
  assert.ok(si > 0)
  let ei = si + 1
  while (ei < L.length && (L[ei] === '' || L[ei].startsWith('            '))) ei++
  const block = L.slice(si + 1, ei).filter(l => l.trim())
  assert.ok(block.length <= 40, `pr-comment script is ${block.length} lines`)
  assert.ok(block.join('\n').includes('scripts/lib/pr-status-io.mjs'))
  assert.ok(block.join('\n').includes('runStatus('))
})
