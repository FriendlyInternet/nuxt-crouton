import { test } from 'node:test'
import assert from 'node:assert/strict'
import { classify, classifyComment, joinRuns, median, summarizeRuns, legacyClassifyComment, NOTE_MARKER } from './run-outcome.mjs'
import { buildRecord, writeRecord, conclusionOf } from '../eval-ledger/record-run.mjs'
import { subjectFromLog } from '../eval-ledger/backfill.mjs'

const win = { start: '2026-11-03T10:00:00Z', end: '2026-11-03T10:30:00Z' }
const at = '2026-11-03T10:10:00Z'
const note = (id, extra = '') => ({ id, created_at: at, user: { login: 'nuxt-harness[bot]' }, body: `${NOTE_MARKER}\n> 🤖 ${extra}` })
const agent = (id, body = 'my plan') => ({ id, created_at: at, user: { login: 'nuxt-harness[bot]' }, body })

test('1. run note + work-run breadcrumb (both marked) only → nothing', () => {
  const r = classify({ comments: [note(1, 'run note'), note(2, '<!-- work-run:5 -->')] }, win)
  assert.deepEqual(r.produced, ['nothing'])
})

test('2. planner’s own unmarked plan comment → comment with its id', () => {
  const r = classify({ comments: [note(1), agent(7, '<!-- pipeline-plan:v1 --> plan')] }, win)
  assert.deepEqual(r.produced, ['comment'])
  assert.deepEqual(r.produced_ids, [7])
})

test('3. commit pushed, no comment → commit', () => {
  const r = classify({ commits: [{ sha: 'abcdef123456', commit: { committer: { date: at } } }] }, win)
  assert.deepEqual(r.produced, ['commit'])
  assert.deepEqual(r.produced_ids, ['abcdef1'])
})

test('items outside the run window are not counted', () => {
  const r = classify({ comments: [{ ...agent(1), created_at: '2026-11-03T09:00:00Z' }] }, win)
  assert.deepEqual(r.produced, ['nothing'])
})

test('verdict comments and reviews count as verdict', () => {
  assert.equal(classifyComment({ user: { login: 'nuxt-harness[bot]' }, body: `${NOTE_MARKER}<!-- plan-review-verdict:no-go -->` }), 'verdict')
  assert.deepEqual(classify({ reviews: [{ id: 3, submitted_at: at }] }, win).produced, ['verdict'])
})

test('5. overlapping runs share; an exact run-link comment is credited only to its run', () => {
  const a = { run_id: 1, start: '2026-11-03T10:00:00Z', end: '2026-11-03T10:30:00Z' }
  const b = { run_id: 2, start: '2026-11-03T10:20:00Z', end: '2026-11-03T10:50:00Z' }
  const comments = [{ id: 10, body: 'x https://github.com/o/r/actions/runs/2' }, { id: 11, body: 'plain' }]
  const ja = joinRuns(a, [a, b], comments)
  assert.deepEqual(ja.overlap, ['2'])
  assert.equal(ja.attribution, 'shared')
  assert.deepEqual(ja.excludeIds, [10])
  const jb = joinRuns(b, [a, b], comments)
  assert.deepEqual(jb.overlap, ['1'])
  assert.deepEqual(jb.exactMine, [10])
  assert.equal(joinRuns(a, [a], []).attribution, 'exact')
})

test('8. revise no-op note (marked) only → nothing; success note + commit → commit', () => {
  assert.deepEqual(classify({ comments: [note(1, 'Revise produced no change')] }, win).produced, ['nothing'])
  const r = classify({ comments: [note(2, 'Revised')], commits: [{ sha: 'a'.repeat(40), commit: { author: { date: at } } }] }, win)
  assert.deepEqual(r.produced, ['commit'])
})

test('9. resolver "ended without resolving" note only → nothing', () => {
  assert.deepEqual(classify({ comments: [note(1, 'the resolver ended without resolving anything (#3002)')] }, win).produced, ['nothing'])
})

test('10. interpreter comment from interpret-act in the window → comment on that run’s record', async () => {
  const env = { REPO: 'o/r', RUN_ID: '9', RUN_ATTEMPT: '1', WORKFLOW_FILE: 'on-comment.yml', STAGE: 'interpret', ISSUE: '42', NEEDS_JSON: '{"interpret-act":{"result":"success"}}' }
  const api = async (p) => {
    if (p.includes('/actions/runs/9')) return { run_started_at: '2026-11-03T10:00:00Z' }
    if (p.includes('/pulls?')) return []
    if (p.includes('/issues/42/comments')) return [agent(77, 'Here is my reading of your comment.')]
    return []
  }
  const rec = await buildRecord({ env, api, listRecords: async () => [], rlEnd: { remaining: 3700, reset: 5 }, now: new Date('2026-11-03T10:30:00Z') })
  assert.deepEqual(rec.produced, ['comment'])
  assert.deepEqual(rec.produced_ids, [77])
  assert.equal(rec.api_calls, null) // no start read → null + reason
  assert.equal(rec.api_calls_reason, 'start-read-failed')
})

test('11. api_calls + token kind flow into the record', async () => {
  const env = { REPO: 'o/r', RUN_ID: '9', RUN_ATTEMPT: '1', WORKFLOW_FILE: 'plan-review.yml', STAGE: 'plan-review', ISSUE: '1', TOKEN_KIND: 'app', RL_START: '{"remaining":4000,"reset":5}', NEEDS_JSON: '{}' }
  const api = async (p) => (p.includes('/actions/runs/') ? { run_started_at: '2026-11-03T10:00:00Z' } : [])
  const rec = await buildRecord({ env, api, listRecords: async () => [], rlEnd: { remaining: 3700, reset: 5 } })
  assert.equal(rec.api_calls, 300)
  assert.equal(rec.token, 'app')
  assert.deepEqual(rec.produced, ['nothing'])
  const rec2 = await buildRecord({ env: { ...env, TOKEN_KIND: '' }, api, listRecords: async () => [], rlEnd: { remaining: 1, reset: 6 } })
  assert.equal(rec2.token, 'github_token')
  assert.equal(rec2.api_calls_reason, 'reset-window-changed')
})

test('median ignores nulls; weekly summary counts missing records', () => {
  assert.equal(median([300, null, 100, undefined, 200]), 200)
  assert.equal(median([null]), null)
  const s = summarizeRuns(
    [{ id: 1, workflow: 'w' }, { id: 2, workflow: 'w' }, { id: 3, workflow: 'w' }],
    [{ run_id: '1', produced: ['nothing'], api_calls: 100 }, { run_id: '2', produced: ['comment'], api_calls: null }],
  )
  assert.deepEqual(s.w, { runs: 3, produced: 1, nothing: 1, shared: 0, missing: 1, unknown: 0, api_calls_median: 100 })
})

test('6. two parallel writes land on distinct paths', async () => {
  const puts = []
  const fetchImpl = async (url, init) => {
    const method = init?.method || 'GET'
    if (method === 'PUT') { puts.push(url); return { status: 201, json: async () => ({}) } }
    return { status: 200, json: async () => ({}) } // branch exists
  }
  const base = { repo: 'o/r', token: 't', fetchImpl, sleep: async () => {} }
  const mk = (id) => ({ run_id: id, attempt: '1', workflow: 'w.yml', started_at: '2026-11-03T10:00:00Z' })
  const [a, b] = await Promise.all([writeRecord({ ...base, record: mk('1') }), writeRecord({ ...base, record: mk('2') })])
  assert.notEqual(a, b)
  assert.equal(new Set(puts).size, 2)
})

test('write: 409 is retried; an unreachable API throws (caller exits 0)', async () => {
  let n = 0
  const flaky = async (url, init) => {
    if ((init?.method || 'GET') === 'PUT') return { status: ++n < 3 ? 409 : 201, json: async () => ({}) }
    return { status: 200, json: async () => ({}) }
  }
  await writeRecord({ repo: 'o/r', token: 't', fetchImpl: flaky, sleep: async () => {}, record: { run_id: '1', attempt: '1', workflow: 'w', started_at: '2026-11-03T10:00:00Z' } })
  assert.equal(n, 3)
  await assert.rejects(writeRecord({ repo: 'o/r', token: 't', fetchImpl: async () => { throw new Error('down') }, record: { run_id: '1', attempt: '1', started_at: '2026-11-03' } }))
})

test('record-run CLI exits 0 even when the API is unreachable', async () => {
  const { spawnSync } = await import('node:child_process')
  const r = spawnSync(process.execPath, ['scripts/eval-ledger/record-run.mjs'], {
    env: { ...process.env, REPO: 'o/r', RUN_ID: '1', GH_TOKEN: 't', DATA_TOKEN: 't', GITHUB_API_URL: 'http://127.0.0.1:9' },
    encoding: 'utf8',
  })
  assert.equal(r.status, 0)
  assert.match(r.stdout, /run record skipped/)
})

test('conclusionOf: cancelled/failure win; skipped-only is skipped', () => {
  assert.equal(conclusionOf('{"a":{"result":"success"},"b":{"result":"cancelled"}}'), 'cancelled')
  assert.equal(conclusionOf('{"a":{"result":"failure"}}'), 'failure')
  assert.equal(conclusionOf('{"a":{"result":"skipped"}}'), 'skipped')
  assert.equal(conclusionOf('garbage'), 'unknown')
})

test('7. backfill: legacy rule + subject from log; nothing rows keep the run URL', async () => {
  assert.deepEqual(subjectFromLog('  ISSUE: 123\n', 'main'), { issue: 123, pr: null })
  assert.deepEqual(subjectFromLog('', 'work-45'), { issue: 45, pr: null })
  assert.deepEqual(subjectFromLog('nothing here', 'main'), { issue: null, pr: null })
  // old comments carry no marker: the legacy rule recognises the workflow's own notes by header text
  assert.equal(legacyClassifyComment({ user: { login: 'nuxt-harness[bot]' }, body: '> 🤖 **pi.dev harness** · agent pipeline (CI) · _revision (#2446)_\n\nx' }), null)
  assert.equal(legacyClassifyComment({ user: { login: 'nuxt-harness[bot]' }, body: 'real plan text' }), 'comment')
  const env = { REPO: 'o/r', RUN_ID: '5', RUN_ATTEMPT: '1', WORKFLOW_FILE: 'work-issue-pidev.yml', STAGE: 'backfill', RULE: 'legacy', SOURCE: 'backfill', ISSUE: '123', NEEDS_JSON: '{}' }
  const api = async (p) => (p.includes('/actions/runs/') ? { run_started_at: '2026-10-25T10:00:00Z' } : p.includes('/issues/123/comments') ? [{ id: 1, created_at: '2026-10-25T10:05:00Z', user: { login: 'nuxt-harness[bot]' }, body: '> 🤖 **pi.dev harness** · _revision (#2446)_' }] : [])
  const rec = await buildRecord({ env, api, listRecords: async () => [], rlEnd: { error: 'backfill' }, now: new Date('2026-10-25T10:30:00Z') })
  assert.equal(rec.source, 'backfill')
  assert.equal(rec.rule, 'legacy')
  assert.deepEqual(rec.produced, ['nothing'])
  assert.equal(rec.ref, 'https://github.com/o/r/actions/runs/5')
})
