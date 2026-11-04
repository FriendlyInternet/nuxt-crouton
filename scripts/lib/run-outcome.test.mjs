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

// ── through the real record builder (bot filter, PR-by-branch lookup, overlap exclusion) ──
let runsList = []
const mkApi = (comments) => async (p) => {
  if (p.includes('/actions/runs/')) return { run_started_at: '2026-11-03T10:00:00Z' }
  if (p.includes('/actions/workflows/')) return { workflow_runs: runsList }
  if (p.includes('/pulls?')) return [{ number: 99 }]
  if (p.includes('/issues/42/')) return comments
  return []
}
const base = { REPO: 'o/r', RUN_ID: '9', RUN_ATTEMPT: '1', WORKFLOW_FILE: 'plan-review.yml', STAGE: 'plan-review', ISSUE: '42', NEEDS_JSON: '{}' }
const build = (env, comments, listRecords = async () => []) =>
  buildRecord({ env: { ...base, ...env }, api: mkApi(comments), listRecords, rlEnd: { remaining: 1, reset: 5 }, now: new Date('2026-11-03T10:30:00Z') })

test('buildRecord: marked notes only → nothing; a human’s comment is not agent output', async () => {
  const human = { id: 3, created_at: at, user: { login: 'someone' }, body: 'hi' }
  assert.deepEqual((await build({}, [note(1), note(2), human])).produced, ['nothing'])
})

test('buildRecord: the agent’s own unmarked comment is never lost (with the PR looked up by branch)', async () => {
  const rec = await build({}, [note(1), agent(7, 'the plan')])
  assert.deepEqual(rec.produced, ['comment'])
  assert.deepEqual(rec.produced_ids, [7])
  assert.equal(rec.pr, 99)
  assert.match(rec.model, /^claude-/) // default tier from the models file
})

test('buildRecord: an overlapping sibling run’s comment is excluded from this run', async () => {
  const sibling = async () => [{ workflow: 'plan-review.yml', issue: 42, run_id: '8', started_at: '2026-11-03T09:50:00Z', ended_at: '2026-11-03T10:20:00Z' }]
  const rec = await build({}, [agent(7, 'sibling plan')], sibling)
  assert.deepEqual(rec.overlap, ['8'])
})

test('buildRecord: an in-flight same-workflow run (no record yet) is flagged as overlap', async () => {
  runsList = [{ id: 8, run_started_at: '2026-11-03T10:05:00Z', updated_at: '2026-11-03T10:40:00Z' }, { id: 9, run_started_at: '2026-11-03T10:00:00Z', updated_at: '2026-11-03T10:30:00Z' }, { id: 7, run_started_at: '2026-11-03T08:00:00Z', updated_at: '2026-11-03T08:30:00Z' }]
  try {
    const rec = await build({}, [agent(7, 'x')])
    assert.deepEqual(rec.overlap, ['8']) // not itself, not the run that ended before this one began
    assert.equal(rec.attribution, 'shared')
  } finally { runsList = [] }
})

test('the unmarked auto-merge note from the real PR #3308 is the reason every workflow note carries the marker', () => {
  const real = { id: 5, created_at: at, user: { login: 'nuxt-harness[bot]' }, body: '<!-- automerge-ci-missing -->\n⏸️ **Not auto-merged — `CI Gate` never reported.**' }
  assert.equal(classifyComment(real), 'comment') // unmarked: indistinguishable from agent output
  assert.equal(classifyComment({ ...real, body: real.body.replace('\n', '\n<!-- pipeline-note -->\n') }), null)
})

test('tierModel reads the tier from the models file, unknown when unreadable', async () => {
  const { tierModel } = await import('../eval-ledger/record-run.mjs')
  assert.match(tierModel('review'), /^claude-/)
  assert.equal(tierModel('review', '/nonexistent.json'), 'unknown')
})

test('backfill: skipped runs are not recorded; listing pages past 100', async () => {
  const { isRecordable, listAllRuns } = await import('../eval-ledger/backfill.mjs')
  assert.equal(isRecordable({ conclusion: 'skipped' }), false)
  assert.equal(isRecordable({ conclusion: 'success' }), true)
  const pages = []
  const get = async (p) => { pages.push(p); const n = Number(/&page=(\d+)/.exec(p)[1]); return { workflow_runs: Array.from({ length: n < 3 ? 100 : 5 }, (_, i) => ({ id: n * 1000 + i })) } }
  assert.equal((await listAllRuns(get, 'o/r', 'w.yml', 'a', 'b')).length, 205)
  assert.equal(pages.length, 3)
})

// ── commit lookup through buildRecord (cases 3, 8, 9 end to end, not hand-built lists) ──
const commitAt = (sha, date) => ({ sha, commit: { committer: { date } } })
const mkApiCommits = ({ comments = [], prCommits = [], branchCommits = [], pr = true }) => async (p) => {
  if (p.includes('/actions/runs/')) return { run_started_at: '2026-11-03T10:00:00Z' }
  if (p.includes('/pulls?')) return pr ? [{ number: 99 }] : []
  if (p.includes('/pulls/99/commits')) return prCommits
  if (p.includes('/commits?sha=')) return branchCommits
  if (p.includes('/issues/')) return comments
  return []
}
const buildC = (opts) => buildRecord({ env: { ...base }, api: mkApiCommits(opts), listRecords: async () => [], rlEnd: { remaining: 1, reset: 5 }, now: new Date('2026-11-03T10:30:00Z') })

test('3 (buildRecord). commit on the PR, no comment → commit', async () => {
  const rec = await buildC({ prCommits: [commitAt('abcdef123456', at)] })
  assert.deepEqual(rec.produced, ['commit'])
  assert.deepEqual(rec.produced_ids, ['abcdef1'])
})

test('3 (buildRecord). no PR yet: the branch’s commits since the run start count', async () => {
  const rec = await buildC({ pr: false, branchCommits: [commitAt('1234567abcdef', at)] })
  assert.deepEqual(rec.produced, ['commit'])
})

test('3 (buildRecord). a commit from before the run is not this run’s output', async () => {
  const rec = await buildC({ prCommits: [commitAt('abcdef123456', '2026-11-03T08:00:00Z')] })
  assert.deepEqual(rec.produced, ['nothing'])
})

test('8 (buildRecord). revise no-op note only → nothing; note + commit → commit', async () => {
  assert.deepEqual((await buildC({ comments: [note(1, 'Revise produced no change')] })).produced, ['nothing'])
  const rec = await buildC({ comments: [note(2, 'Revised')], prCommits: [commitAt('abcdef123456', at)] })
  assert.deepEqual(rec.produced, ['commit'])
})

test('9 (buildRecord). resolver "ended without resolving" note only → nothing', async () => {
  const rec = await buildC({ comments: [note(1, 'the resolver ended without resolving anything (#3002)')] })
  assert.deepEqual(rec.produced, ['nothing'])
})

test('buildRecord: the agent’s own reply without the marker is kept; with the marker it would be dropped', async () => {
  const kept = await buildC({ comments: [agent(5, 'Answer to your question')] })
  assert.deepEqual(kept.produced, ['comment'])
  const dropped = await buildC({ comments: [agent(6, `${NOTE_MARKER}\nAnswer to your question`)] })
  assert.deepEqual(dropped.produced, ['nothing'])
})
