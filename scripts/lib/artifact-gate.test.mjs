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
  const run = (env) => artifactGate({ github, core, context: { repo: { owner: 'o', repo: 'r' }, runId: 1, serverUrl: 'https://x', payload: {} }, env: { ...BASE, ...env }, fs: { existsSync: () => false }, execFileSync: () => '' })
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

test('conflict asked: OK without touching GitHub', async () => {
  const h = harness()
  const boom = () => { throw new Error('called GitHub') }
  const calls = { failed: [], info: [] }
  await artifactGate({ github: { paginate: boom, rest: {} }, core: { setFailed: (m) => calls.failed.push(m), info: (m) => calls.info.push(m) }, context: { repo: {} }, env: { ...BASE, CONFLICT_ASKED: '1' } })
  assert.equal(calls.failed.length, 0)
  assert.equal(calls.info.length, 1)
  void h
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
