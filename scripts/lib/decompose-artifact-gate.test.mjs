import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { decomposeArtifactGate } from './decompose-artifact-gate.mjs'

const T0 = '2026-01-01T00:00:00Z'
const BEFORE = '2025-12-31T23:00:00Z'
const AFTER = '2026-01-01T01:00:00Z'
const BASE = { ISSUE_NUMBER: '7', RUN_START: T0, TRIGGER: 'issues', AGENT_RUNNER_LABEL: 'gh' }

function harness({ comments = [], timeline = [], issue = {}, subs = [], childTimeline = [], childComments = [], throwPaginate = false } = {}) {
  const calls = { failed: [], info: [], created: [] }
  const core = { setFailed: (m) => calls.failed.push(m), info: (m) => calls.info.push(m), warning() {}, error() {} }
  const github = {
    paginate: async (fn, p) => {
      if (throwPaginate) throw new Error('paginate must not be called')
      if (fn === 'comments') return p.issue_number === 7 ? comments : childComments
      if (fn === 'timeline') return p.issue_number === 7 ? timeline : childTimeline
      return typeof fn === 'string' && fn.startsWith('GET ') ? subs : []
    },
    rest: {
      issues: {
        listComments: 'comments',
        listEventsForTimeline: 'timeline',
        get: async () => ({ data: { labels: [], state: 'open', ...issue } }),
        createComment: async (a) => calls.created.push(a.body),
      },
    },
  }
  const run = (env = {}, fsOpts = {}) => decomposeArtifactGate({
    github, core,
    context: { repo: { owner: 'o', repo: 'r' }, runId: 1, serverUrl: 'https://x', payload: {} },
    env: { ...BASE, ...env },
    fs: { existsSync: () => fsOpts.exists ?? false, readFileSync: () => fsOpts.log ?? '' },
  })
  return { calls, run }
}

const prRef = (at = AFTER) => ({ event: 'cross-referenced', created_at: at, source: { issue: { number: 9, pull_request: {} } } })
const blocked = { labels: [{ name: 'status:blocked' }] }
const cm = (body = 'hi') => ({ body, html_url: 'https://x/c/1' })

test('invalid run-start fails without calling GitHub', async () => {
  const { calls, run } = harness({ throwPaginate: true })
  await run({ RUN_START: '' })
  assert.equal(calls.failed.length, 1)
  assert.match(calls.failed[0], /run-start time/)
})

test('nothing produced and no log', async () => {
  const { calls, run } = harness()
  await run()
  assert.match(calls.failed[0], /produced no deliverable/)
  assert.equal(calls.created.length, 1)
  assert.ok(calls.created[0].startsWith('<!-- pipeline-note -->'))
  assert.match(calls.created[0], /pi produced NO run log at all/)
  assert.match(calls.created[0], /CI · gh/)
})

test('fresh PR passes', async () => {
  const { calls, run } = harness({ timeline: [prRef()] })
  await run()
  assert.equal(calls.failed.length, 0)
  assert.match(calls.created[0], /done → PR #9/)
})

test('stale PR (#1019) fails', async () => {
  const { calls, run } = harness({ timeline: [prRef(BEFORE)] })
  await run()
  assert.match(calls.failed[0], /produced no deliverable/)
})

test('leaf dispatched (#1740)', async () => {
  const ev = (at) => ({ event: 'labeled', label: { name: 'work-this' }, created_at: at })
  const ok = harness({ timeline: [ev(AFTER)] })
  await ok.run()
  assert.equal(ok.calls.failed.length, 0)
  assert.match(ok.calls.created[0], /classified as a leaf/)
  const stale = harness({ timeline: [ev(BEFORE)] })
  await stale.run()
  assert.equal(stale.calls.failed.length, 1)
})

test('sub-issues created this run', async () => {
  const { calls, run } = harness({ subs: [{ number: 11, created_at: AFTER, state: 'open' }] })
  await run()
  assert.equal(calls.failed.length, 0)
  assert.match(calls.created[0], /decomposed → sub-issues created/)
})

test('holds: action / answer / approval / plain', async () => {
  const cases = [
    ['## 🔀 Blocked — x\n**Needs:** action', /needs you to APPLY something[\s\S]*https:\/\/x\/c\/1/],
    ['## 🔀 Blocked — x', /asked you a question/],
    ['## 🔀 Blocked — x\n**Needs:** approval', /held for sign-off/],
    ['just a comment', /held for sign-off/],
  ]
  for (const [body, re] of cases) {
    const { calls, run } = harness({ issue: blocked, comments: [cm(body)] })
    await run()
    assert.equal(calls.failed.length, 0, body)
    assert.match(calls.created[0], re, body)
  }
})

test('partial output fails', async () => {
  const a = harness({ issue: blocked })
  await a.run()
  assert.equal(a.calls.failed.length, 1)
  const b = harness({ comments: [cm()] })
  await b.run()
  assert.equal(b.calls.failed.length, 1)
})

test('already closed passes', async () => {
  const { calls, run } = harness({ issue: { state: 'closed' } })
  await run()
  assert.equal(calls.failed.length, 0)
})

test('child deliverables (#1074)', async () => {
  const closed = harness({ subs: [{ number: 11, created_at: BEFORE, state: 'closed', closed_at: AFTER }] })
  await closed.run()
  assert.equal(closed.calls.failed.length, 0)
  assert.ok(closed.calls.info.some((m) => /via child deliverable/.test(m)))
  assert.match(closed.calls.created[0], /resumed the existing tree → child #11 closed this run/)

  const pr = harness({ subs: [{ number: 11, created_at: BEFORE, state: 'open' }], childTimeline: [prRef()] })
  await pr.run()
  assert.match(pr.calls.created[0], /PR linked to child #11/)

  const held = harness({ subs: [{ number: 11, created_at: BEFORE, state: 'open', labels: [{ name: 'status:blocked' }] }], childComments: [cm()] })
  await held.run()
  assert.match(held.calls.created[0], /held for sign-off this run/)
})

test('no human watching: no comments on workflow_dispatch', async () => {
  const a = harness({ timeline: [prRef()] })
  await a.run({ TRIGGER: 'workflow_dispatch' })
  assert.equal(a.calls.failed.length, 0)
  assert.equal(a.calls.created.length, 0)
  const b = harness({ subs: [{ number: 11, created_at: BEFORE, state: 'closed', closed_at: AFTER }] })
  await b.run({ TRIGGER: 'workflow_dispatch' })
  assert.equal(b.calls.failed.length, 0)
  assert.equal(b.calls.created.length, 0)
})

test('log buckets', async () => {
  const go = async (log, env = {}) => {
    const { calls, run } = harness()
    await run(env, { exists: true, log })
    assert.equal(calls.failed.length, 1)
    return calls.created[0]
  }
  const env = { PI_EXEC_LOG: '/tmp/x' }
  let b = await go('429 {"code":"1308"} Your limit will reset at 2026-01-01 05:00:00', env)
  assert.match(b, /GLM Coding Plan quota/)
  assert.match(b, /resets at 2026-01-01 05:00:00/)
  b = await go('credit balance is too low', env)
  assert.match(b, /PI_PROVIDER_KEY/)
  b = await go('boom', { ...env, CLAUDE_CONCLUSION: 'failure' })
  assert.match(b, /errored before it built anything/)
  assert.match(b, /<details><summary>log tail/)
  b = await go('PI_TASK_COMPLETE_NOTHING_LEFT', env)
  assert.match(b, /deliberately concluded there was NOTHING left/)
  b = await go('something odd', env)
  assert.match(b, /none of the known causes matched/)
  assert.match(b, /log tail/)
  b = await go('a'.repeat(100) + 'b'.repeat(600), env)
  assert.ok(b.includes('b'.repeat(600)) && !b.includes('a'.repeat(5)))
})

test('no log + failed step: NO run log text wins', async () => {
  const { calls, run } = harness()
  await run({ CLAUDE_CONCLUSION: 'failure' })
  assert.match(calls.created[0], /NO run log/)
  assert.doesNotMatch(calls.created[0], /failed before producing anything/)
})

test('workflow wiring: gate step declares every env the module reads', () => {
  const yml = readFileSync(new URL('../../.github/workflows/decompose-on-issue-pidev.yml', import.meta.url), 'utf8')
  const start = yml.indexOf('- name: Artifact-gate — fail if the agent produced nothing')
  assert.ok(start > 0)
  const rest = yml.slice(start + 10)
  const next = rest.search(/\n      (- name:|# ──)/)
  const step = yml.slice(start, start + 10 + (next < 0 ? rest.length : next))
  const src = readFileSync(new URL('./decompose-artifact-gate.mjs', import.meta.url), 'utf8')
  const vars = new Set([...src.matchAll(/\benv\.([A-Z_]+)/g)].map((m) => m[1]))
  assert.ok(vars.size >= 5)
  for (const v of vars) assert.match(step, new RegExp(`\\n\\s+${v}:`), `${v} missing from gate step env`)
  assert.match(step, /decompose-artifact-gate\.mjs/)
})
