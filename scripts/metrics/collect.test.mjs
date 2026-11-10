import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { splitWindow, toRunRow, toJobRow, selectRunDays, jobsWorkList, collect, parseCrons } from './collect.mjs'

const NOW = Date.parse('2026-11-10T12:00:00Z')
const apiRun = (id, o = {}) => ({
  id, run_attempt: 1, path: '.github/workflows/ci.yml', name: 'CI', event: 'push', head_branch: 'main', head_sha: 'abc',
  pull_requests: [{ number: 7 }], created_at: '2026-11-10T01:00:00Z', run_started_at: '2026-11-10T01:00:01Z', updated_at: '2026-11-10T01:05:00Z',
  status: 'completed', conclusion: 'success', actor: { login: 'someone' }, display_title: 'secret title',
  head_commit: { author: { email: 'a@b.c' }, message: 'msg' }, ...o,
})

test('splitWindow splits a window whose count is >= 1000', async () => {
  const from = Date.parse('2026-11-09T00:00:00Z') / 1000
  const win = { from, to: from + 86399 }
  const half = from + Math.floor(86399 / 2)
  const count = async (a, b) => {
    const f = Date.parse(a) / 1000, t = Date.parse(b) / 1000
    if (f === win.from && t === win.to) return 2500
    if (f === win.from && t === half) return 1200
    return 50
  }
  const out = await splitWindow(win, count)
  assert.ok(out.length >= 3)
  assert.equal(out[0].from, win.from)
  assert.equal(out.at(-1).to, win.to)
  for (let i = 1; i < out.length; i++) assert.equal(out[i].from, out[i - 1].to + 1)
})

test('splitWindow keeps a small window whole', async () => {
  const out = await splitWindow({ from: 0, to: 86399 }, async () => 3)
  assert.equal(out.length, 1)
})

test('run and job rows hold only allow-listed keys', () => {
  const r = toRunRow(apiRun(1))
  assert.deepEqual(Object.keys(r).sort(), ['attempt', 'branch', 'conclusion', 'created', 'ended', 'event', 'id', 'prs', 'sha', 'started', 'status', 'workflow'])
  assert.equal(r.workflow, 'ci.yml')
  assert.ok(!JSON.stringify(r).includes('secret') && !JSON.stringify(r).includes('a@b.c'))
  const j = toJobRow({ name: 'b', started_at: 's', completed_at: 'e', conclusion: 'failure', runner_name: 'x', steps: [{ name: 'a', conclusion: 'success' }] })
  assert.deepEqual(Object.keys(j).sort(), ['conclusion', 'ended', 'failed_step', 'name', 'started'])
})

test('first failed step is the first step with conclusion failure', () => {
  const steps = [{ name: 'a', conclusion: 'success' }, { name: 'b', conclusion: 'failure' }, { name: 'c', conclusion: 'failure' }]
  assert.equal(toJobRow({ name: 'j', steps }).failed_step, 'b')
  assert.equal(toJobRow({ name: 'j', steps: [steps[0]] }).failed_step, null)
})

test('runs day selection: fetch a never-fetched day, re-fetch a non-final day after 6h, leave final days alone', () => {
  const fetchedAt = {
    '2026-11-10': '2026-11-10T11:00:00Z', // fetched 1h ago → leave
    '2026-11-09': '2026-11-10T04:00:00Z', // non-final, fetched 8h ago → refetch
    '2026-11-01': '2026-11-10T04:00:00Z', // ended >48h before the fetch → final
  }
  const days = selectRunDays({ nowMs: NOW, fetchedAt, days: 10 })
  assert.ok(days.includes('2026-11-09') && !days.includes('2026-11-10') && !days.includes('2026-11-01'))
  assert.ok(days.includes('2026-11-05')) // never fetched → fetch it
})

test('jobs work list: completed non-skipped runs without a line, oldest first; a raised attempt is fetched again', () => {
  const r = (id, o = {}) => ({ id, attempt: 1, status: 'completed', conclusion: 'success', ...o })
  const runsByDay = { '2026-11-02': [r(5), r(4, { conclusion: 'skipped' }), r(3, { status: 'in_progress', conclusion: null })], '2026-11-01': [r(1), r(2, { attempt: 2 })] }
  const jobsByDay = { '2026-11-01': [{ run_id: 1, attempt: 1, jobs: [] }, { run_id: 2, attempt: 1, jobs: [] }] }
  assert.deepEqual(jobsWorkList(runsByDay, jobsByDay).map(w => w.run.id), [2, 5])
})

function stub(nRuns, { remainingAfter = {} } = {}) {
  const calls = { jobs: 0, other: 0 }
  const runs = Array.from({ length: nRuns }, (_, i) => apiRun(100 + i))
  const fetchImpl = async (url) => {
    const h = {}
    if (/\/jobs/.test(url)) {
      calls.jobs++
      if (remainingAfter[calls.jobs] !== undefined) h['x-ratelimit-remaining'] = String(remainingAfter[calls.jobs])
      return { status: 200, headers: h, json: { jobs: [{ name: 'build', conclusion: 'success', steps: [] }] } }
    }
    calls.other++
    if (url.includes('per_page=1&') || url.endsWith('per_page=1')) return { status: 200, headers: h, json: { total_count: nRuns } }
    // only the day of the runs has data
    return { status: 200, headers: h, json: { workflow_runs: url.includes('2026-11-10T00:00:00Z') ? runs : [] } }
  }
  return { fetchImpl, calls }
}
const opts = (data, fetchImpl, extra = {}) => ({ data, repo: 'o/r', fetchImpl, nowMs: NOW, days: 0, log: () => {}, ...extra })
const lines = (data) => readFileSync(join(data, 'metrics/jobs/2026-11-10.jsonl'), 'utf8').split('\n').filter(Boolean)

test('collect stops at the reserve and keeps what it fetched; a second collect resumes', async () => {
  const data = mkdtempSync(join(tmpdir(), 'collect-'))
  const s = stub(5, { remainingAfter: { 3: 1499 } })
  const first = await collect(opts(data, s.fetchImpl, { remaining: 5000 }))
  assert.equal(lines(data).length, 3)
  assert.equal(first.pending, 2)
  const s2 = stub(5)
  const second = await collect(opts(data, s2.fetchImpl, { remaining: 5000, nowMs: NOW + 60000 }))
  assert.equal(s2.calls.jobs, 2)
  assert.equal(lines(data).length, 5)
  assert.equal(second.pending, 0)
})

test('parseCrons reads cron lines and skips comments', () => {
  assert.deepEqual(parseCrons("on:\n  schedule:\n    - cron: '17 * * * *'   # hourly\n    # - cron: '1 1 1 1 1'\n"), ['17 * * * *'])
})

test('default run on a fresh data folder asks only for today and yesterday', async () => {
  assert.deepEqual(selectRunDays({ nowMs: NOW, fetchedAt: {} }), ['2026-11-09', '2026-11-10'])
  const data = mkdtempSync(join(tmpdir(), 'collect-'))
  const s = stub(2)
  const seen = new Set()
  const fetchImpl = (url, init) => {
    const m = /created=(\d{4}-\d{2}-\d{2})/.exec(url)
    if (m) seen.add(m[1])
    return s.fetchImpl(url, init)
  }
  const { days, ...rest } = opts(data, fetchImpl)
  assert.equal(days, 0)
  await collect(rest)
  assert.deepEqual([...seen].sort(), ['2026-11-09', '2026-11-10'])
})

/** A clock that moves forward 1 s per API call. */
function slowClock(s) {
  let t = NOW
  const fetchImpl = async (url, init) => { t += 1000; return s.fetchImpl(url, init) }
  return { fetchImpl, clock: () => t }
}

test('slow calls hit the time budget: stops, says why, finished days on disk', async () => {
  const data = mkdtempSync(join(tmpdir(), 'collect-'))
  const s = stub(5)
  const { fetchImpl, clock } = slowClock(s)
  const log = []
  const out = await collect(opts(data, fetchImpl, { clock, maxMs: 5000, log: (l) => log.push(l) }))
  assert.equal(out.stopReason, 'time budget')
  assert.ok(out.used <= 5, `used ${out.used}`)
  assert.ok(log.some(l => l.startsWith('::notice::') && l.includes('stopped: time budget')))
  assert.ok(existsSync(join(data, 'metrics/runs/2026-11-10.jsonl')))
  assert.equal(lines(data).length, s.calls.jobs)
  assert.ok(out.pending > 0)
})

test('a call that never answers stops after its time limit and keeps data so far', async () => {
  const data = mkdtempSync(join(tmpdir(), 'collect-'))
  const s = stub(5)
  let jobsCalls = 0
  const fetchImpl = (url, init) => {
    if (/\/jobs/.test(url) && ++jobsCalls >= 3) return new Promise(() => {})
    return s.fetchImpl(url, init)
  }
  const out = await collect(opts(data, fetchImpl, { callTimeoutMs: 50 }))
  assert.match(out.error, /timeout/)
  assert.equal(lines(data).length, 2)
  assert.ok(existsSync(join(data, 'metrics/state.json')))
})

test('second run continues where the first stopped; nothing fetched twice', async () => {
  const data = mkdtempSync(join(tmpdir(), 'collect-'))
  const recorder = (s) => {
    const jobs = [], runsLists = []
    const fetchImpl = (url, init) => {
      if (/\/jobs/.test(url)) jobs.push(url)
      else runsLists.push(url)
      return s.fetchImpl(url, init)
    }
    return { jobs, runsLists, fetchImpl }
  }
  const base = { days: undefined }
  const r1 = recorder(stub(5))
  const c1 = slowClock({ fetchImpl: r1.fetchImpl })
  // 4 runs-list calls (count + page for 2 days), then 2 jobs calls before 6 s run out.
  const first = await collect(opts(data, c1.fetchImpl, { ...base, clock: c1.clock, maxMs: 6000 }))
  assert.equal(first.stopReason, 'time budget')
  assert.ok(r1.jobs.length > 0 && r1.jobs.length < 5, `run 1 jobs ${r1.jobs.length}`)
  const r2 = recorder(stub(5))
  const log = []
  const second = await collect(opts(data, r2.fetchImpl, { ...base, nowMs: NOW + 60000, log: (l) => log.push(l) }))
  assert.equal(r2.runsLists.length, 0)
  assert.ok(!r2.jobs.some(u => r1.jobs.includes(u)))
  assert.equal(r1.jobs.length + r2.jobs.length, 5)
  assert.equal(second.pending, 0)
  assert.equal(lines(data).length, 5)
  assert.ok(log.some(l => /^collect: 2026-11-10 runs \d+, jobs \d+, calls used \d+$/.test(l)), log.join('\n'))
})
