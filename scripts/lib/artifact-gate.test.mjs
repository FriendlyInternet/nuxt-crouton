import { test } from 'node:test'
import assert from 'node:assert/strict'
import { artifactGate } from './artifact-gate.mjs'

const T0 = '2026-01-01T00:00:00Z'
const AFTER = '2026-01-01T01:00:00Z'
const BASE = { ISSUE_NUMBER: '7', RUN_START: T0, TRIGGER: 'issues', AGENT_RUNNER_LABEL: 'gh' }

function harness({ comments = [], timeline = [], issue = {}, subs = [], branch = null, childTimeline = [] } = {}) {
  const calls = { failed: [], info: [], created: [] }
  const core = { setFailed: (m) => calls.failed.push(m), info: (m) => calls.info.push(m), warning() {}, error() {} }
  const github = {
    paginate: async (fn, p) => {
      if (fn === 'comments') return comments
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
      git: {
        getRef: async () => { if (!branch) throw new Error('404'); return { data: { object: { sha: 'abcdef123' } } } },
        getCommit: async () => ({ data: { committer: { date: branch } } }),
      },
    },
  }
  const run = (env, opts = {}) => artifactGate({ github, core, context: { repo: { owner: 'o', repo: 'r' }, runId: 1, serverUrl: 'https://x', payload: {} }, env: { ...BASE, ...env }, fs: { existsSync: () => false }, execFileSync: () => '', ...opts })
  return { calls, run }
}

const prRef = { event: 'cross-referenced', created_at: AFTER, source: { issue: { number: 9, pull_request: {} } } }

test('deliverable found: a PR linked after t0', async () => {
  const h = harness({ timeline: [prRef] })
  await h.run({})
  assert.deepEqual(h.calls.failed, [])
  assert.match(h.calls.info.join('\n'), /Artifact-gate OK/)
})

test('nothing produced: one failure and one pipeline-note comment', async () => {
  const h = harness()
  await h.run({})
  assert.equal(h.calls.failed.length, 1)
  assert.match(h.calls.failed[0], /produced no deliverable/)
  assert.equal(h.calls.created.length, 1)
  assert.match(h.calls.created[0], /<!-- pipeline-note -->/)
})

// #4161: a cancelled job names the stop, not "NO run log". The stub answers only the
// `tool-calls` subcommand, so the count must come from that exact call.
const toolCallsStub = (n) => (cmd, args) => (cmd === 'node' && args[1] === 'tool-calls' && args[2].endsWith('/pi-session') ? `${n}\n` : '')
const at = (min) => () => Date.parse(T0) + min * 60000

test('#4161 T3: cancelled at the 45-minute limit names the limit, minutes, tool calls and the artifact', async () => {
  const h = harness()
  await h.run({ JOB_STATUS: 'cancelled', JOB_TIMEOUT_MIN: '45', RUNNER_TEMP: '/tmp/rt' }, { now: at(43), execFileSync: toolCallsStub(39) })
  assert.equal(h.calls.created.length, 1)
  const c = h.calls.created[0]
  assert.match(c, /45-minute time limit/)
  assert.match(c, /about 43 minutes/)
  assert.match(c, /39 tool calls/)
  assert.match(c, /pi-session-1/)
  assert.doesNotMatch(c, /NO run log/)
})

test('#4161 T4: an early cancel says "cancelled after about N minutes"; not cancelled + no log keeps "NO run log"', async () => {
  const h = harness()
  await h.run({ JOB_STATUS: 'cancelled', JOB_TIMEOUT_MIN: '45', RUNNER_TEMP: '/tmp/rt' }, { now: at(5), execFileSync: toolCallsStub(4) })
  assert.match(h.calls.created[0], /cancelled after about 5 minutes \(4 tool calls\)/)
  assert.doesNotMatch(h.calls.created[0], /time limit/)
  assert.match(h.calls.created[0], /pi-session-1/)
  const h2 = harness()
  await h2.run({}, { now: at(5) })
  assert.match(h2.calls.created[0], /NO run log/)
  assert.doesNotMatch(h2.calls.created[0], /cancelled after/)
})

test('conflict asked: OK without touching GitHub', async () => {
  const h = harness()
  const boom = () => { throw new Error('called GitHub') }
  const calls = { failed: [], info: [] }
  await artifactGate({ github: { paginate: boom, rest: {} }, core: { setFailed: (m) => calls.failed.push(m), info: (m) => calls.info.push(m) }, context: { repo: {} }, env: { ...BASE, CONFLICT_ASKED: '1' } })
  assert.equal(calls.failed.length, 0)
  assert.equal(calls.info.length, 1)
  void h
})

test('merge refused: OK without touching GitHub (#3704)', async () => {
  const boom = () => { throw new Error('called GitHub') }
  const calls = { failed: [], info: [], created: [] }
  const github = { paginate: boom, rest: { issues: { listComments: boom, createComment: async (a) => calls.created.push(a.body) } } }
  await artifactGate({ github, core: { setFailed: (m) => calls.failed.push(m), info: (m) => calls.info.push(m) }, context: { repo: {} }, env: { ...BASE, MERGE_REFUSED: '1' } })
  assert.equal(calls.failed.length, 0)
  assert.equal(calls.info.length, 1)
  assert.equal(calls.created.length, 0)
})

test('owner-request worker failed: red, names the exit code, no GitHub calls (#3775)', async () => {
  const boom = () => { throw new Error('called GitHub') }
  const calls = { failed: [], info: [] }
  const github = { paginate: boom, rest: { issues: { listComments: boom, createComment: boom } } }
  await artifactGate({ github, core: { setFailed: (m) => calls.failed.push(m), info: (m) => calls.info.push(m) }, context: { repo: {} }, env: { ...BASE, REQUEST_FAILED: '137' } })
  assert.equal(calls.failed.length, 1)
  assert.match(calls.failed[0], /exit 137/)
})

test('decompose resume: a sub-issue closed after t0', async () => {
  const h = harness({ subs: [{ number: 11, state: 'closed', closed_at: AFTER, created_at: '2025-12-31T00:00:00Z', labels: [] }] })
  await h.run({})
  assert.equal(h.calls.failed.length, 0)
  assert.match(h.calls.info.join('\n'), /via child deliverable/)
})

test('pushed without a new PR (#3222): commit on work-<n> after t0', async () => {
  const h = harness({ branch: AFTER })
  await h.run({ FINISH_OUTCOME: 'success' })
  assert.equal(h.calls.failed.length, 0)
  assert.match(h.calls.created[0], /pushed a commit to `work-7`/)
})

test('invalid run-start fails fast', async () => {
  const h = harness()
  await h.run({ RUN_START: '' })
  assert.match(h.calls.failed[0], /run-start time/)
})

test('plan ok and revised exit early OK', async () => {
  for (const k of ['PLAN_OK', 'REVISED']) {
    const h = harness()
    await h.run({ [k]: '1' })
    assert.equal(h.calls.failed.length, 0)
    assert.equal(h.calls.info.length, 1)
  }
})

test('plan malformed + explained (#3028): fails once, posts no comment', async () => {
  const h = harness()
  await h.run({ PLAN_OK: '0', PLAN_EXPLAINED: '1' })
  assert.equal(h.calls.failed.length, 1)
  assert.equal(h.calls.created.length, 0)
})

test('plan run with no plan comment: exactly one 🔴 comment', async () => {
  const h = harness()
  await h.run({ PLAN_OK: '0' })
  assert.equal(h.calls.failed.length, 1)
  assert.equal(h.calls.created.length, 1)
  assert.match(h.calls.created[0], /produced nothing/)
})

// #4183 T6 — the pi step failed at its own time limit: name that, not "upstream of pi".
const nowS = () => Math.floor(Date.now() / 1000)

test('#4183 T6: pi step failed at its deadline, no log, nothing produced → "ran out of time" + the minutes', async () => {
  const h = harness()
  await h.run({ PI_OUTCOME: 'failure', PI_DEADLINE: String(nowS() - 30), PI_MINUTES: '37' })
  assert.equal(h.calls.created.length, 1)
  assert.match(h.calls.created[0], /ran out of time/)
  assert.match(h.calls.created[0], /37-minute/)
  assert.doesNotMatch(h.calls.created[0], /upstream of pi/)
})

test('#4183 T6: pi step failed far before its deadline (a crash) → the old "upstream of pi" text', async () => {
  const h = harness()
  await h.run({ PI_OUTCOME: 'failure', PI_DEADLINE: String(nowS() + 3600), PI_MINUTES: '37' })
  assert.match(h.calls.created[0], /upstream of pi/)
  assert.doesNotMatch(h.calls.created[0], /ran out of time/)
})

test('#4183 T6: plan-mode crash (no deadline, no log) → "upstream of pi", never "ran out of time"', async () => {
  const h = harness()
  await h.run({ PI_OUTCOME: 'failure', PI_DEADLINE: '', PI_MINUTES: '' })
  assert.match(h.calls.created[0], /upstream of pi/)
  assert.doesNotMatch(h.calls.created[0], /ran out of time/)
})

test('#4183 T6: a cancelled job with a past deadline is not our "ran out of time" case (#4161 owns it)', async () => {
  const h = harness()
  await h.run({ JOB_STATUS: 'cancelled', PI_OUTCOME: 'failure', PI_DEADLINE: String(nowS() - 30), PI_MINUTES: '37' })
  assert.doesNotMatch(h.calls.created[0], /the worker ran out of time — the agent step hit its 37-minute limit/)
})
