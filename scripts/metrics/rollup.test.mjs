import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, cpSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { rollup, expandCron, serialize, runRollup, isoWeek } from './rollup.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const LINES = { a: ['x.yml', 'ci.yml', 'e2e.yml', 'weekly.yml', 'hourly.yml', 'm.yml'] }
let id = 0
const run = (o) => ({ id: ++id, attempt: 1, workflow: 'x.yml', event: 'push', branch: 'main', sha: 's', prs: [], created: '2026-11-04T10:00:00Z', started: '2026-11-04T10:00:00Z', ended: '2026-11-04T10:05:00Z', status: 'completed', conclusion: 'success', ...o })
const R = (rows, extra = {}) => rollup({ runs: rows, jobs: [], lines: LINES, dataCommit: 'abc', ...extra })

test('cancelled and skipped runs are left out of the failure rate', () => {
  const rows = [
    ...['success', 'success', 'failure', 'timed_out', 'cancelled', 'cancelled', 'cancelled', 'skipped', 'skipped'].map(conclusion => run({ conclusion })),
  ]
  const w = R(rows).weeks['2026-W45'].workflows['x.yml']
  assert.deepEqual(w, { runs: 4, failed: 2, rate: 0.5 })
})

test('job failure rate keys by workflow/job', () => {
  const rows = [run({ workflow: 'ci.yml' }), run({ workflow: 'e2e.yml', conclusion: 'failure' })]
  const jobs = rows.map(r => ({ run_id: r.id, attempt: 1, jobs: [{ name: 'build', conclusion: r.conclusion }] }))
  const j = rollup({ runs: rows, jobs, lines: LINES }).weeks['2026-W45'].jobs
  assert.deepEqual(Object.keys(j), ['ci.yml/build', 'e2e.yml/build'])
  assert.equal(j['e2e.yml/build'].rate, 1)
  assert.equal(j['ci.yml/build'].rate, 0)
})

test('jobs_coverage shows a partly fetched week', () => {
  const rows = [run({}), run({}), run({}), run({ conclusion: 'failure' })]
  const jobs = rows.slice(0, 2).map(r => ({ run_id: r.id, attempt: 1, jobs: [] }))
  assert.deepEqual(rollup({ runs: rows, jobs, lines: LINES }).weeks['2026-W45'].jobs_coverage, { eligible_runs: 4, runs_with_jobs: 2 })
})

const snap = (map) => [{ date: '2026-01-01', map }]
// a Wednesday run proves the week has data past the Monday slot
const filler = (wf) => run({ workflow: wf, event: 'push', created: '2026-11-11T12:00:00Z', started: '2026-11-11T12:00:00Z' })

test('a missed cron slot is counted', () => {
  const rows = [run({ workflow: 'weekly.yml', created: '2026-11-02T00:00:00Z' }), filler('weekly.yml')]
  const s = R(rows, { schedules: snap({ 'weekly.yml': ['30 6 * * 1'] }) }).weeks['2026-W45'].schedules['weekly.yml']
  assert.equal(s.slots, 1); assert.equal(s.missed, 1)
})

test('a scheduled run within 2 hours of its slot is not missed', () => {
  const at = (t) => R([
    run({ workflow: 'weekly.yml', event: 'schedule', created: t, started: t }), filler('weekly.yml'),
  ], { schedules: snap({ 'weekly.yml': ['30 6 * * 1'] }) }).weeks['2026-W45'].schedules['weekly.yml'].missed
  assert.equal(at('2026-11-02T08:29:00Z'), 0)
  assert.equal(at('2026-11-02T08:31:00Z'), 1)
})

test('a late, non-success scheduled run counts as missed and failed', () => {
  const t = '2026-11-09T16:43:19Z'
  const rows = [run({ workflow: 'weekly.yml', event: 'schedule', created: t, started: t, conclusion: 'cancelled' }), filler('weekly.yml')]
  const s = R(rows, { schedules: snap({ 'weekly.yml': ['30 6 * * 1'] }) }).weeks['2026-W46'].schedules['weekly.yml']
  assert.deepEqual([s.missed, s.failed_runs, s.total], [1, 1, 2])
})

test('no slots before the workflow\'s first run', () => {
  // first run Wednesday 4 Nov 2026; hourly cron; as_of Thursday 00:00 → Wed's 24 hourly slots the last hour is not yet judgeable
  const rows = [run({ workflow: 'hourly.yml', event: 'schedule', created: '2026-11-04T00:05:00Z', started: '2026-11-04T00:05:00Z' }), run({ workflow: 'x.yml', created: '2026-11-05T00:00:00Z' })]
  const s = R(rows, { schedules: snap({ 'hourly.yml': ['0 * * * *'] }) }).weeks['2026-W45'].schedules['hourly.yml']
  assert.equal(s.slots, 23)
})

test('expandCron', () => {
  const day = Date.UTC(2026, 10, 4)
  assert.equal(expandCron('17 * * * *', day, day + 86400000).length, 24)
  assert.equal(expandCron('0 5 1 * *', Date.UTC(2026, 10, 1), Date.UTC(2026, 11, 1)).length, 1)
  const mondays = expandCron('30 6 * * 1', Date.UTC(2026, 10, 1), Date.UTC(2026, 11, 1))
  assert.equal(mondays.length, 5)
  assert.ok(mondays.every(t => new Date(t).getUTCDay() === 1))
  assert.equal(isoWeek('2026-11-09T00:00:00Z'), '2026-W46')
})

test('rollup is byte-identical on the same data, whatever the input order', () => {
  const rows = [run({}), run({ conclusion: 'failure', workflow: 'ci.yml' }), run({ created: '2026-11-10T01:00:00Z' })]
  const jobs = rows.map(r => ({ run_id: r.id, attempt: 1, jobs: [{ name: 'b', conclusion: r.conclusion }] }))
  const a = serialize(rollup({ runs: rows, jobs, lines: LINES }))
  const b = serialize(rollup({ runs: [...rows].reverse(), jobs: [...jobs].reverse(), lines: LINES }))
  assert.equal(a, b)
})

function fixtureDir() {
  const d = mkdtempSync(join(tmpdir(), 'metrics-'))
  cpSync(join(HERE, '__fixtures__', 'metrics'), join(d, 'metrics'), { recursive: true })
  return d
}

test('CLI run twice gives identical latest.json; data_commit and as_of come from the data, not the clock', () => {
  const d = fixtureDir()
  runRollup(d)
  const one = readFileSync(join(d, 'metrics', 'latest.json'), 'utf8')
  const out = runRollup(d)
  assert.equal(one, readFileSync(join(d, 'metrics', 'latest.json'), 'utf8'))
  assert.equal(out.as_of, '2026-11-10T10:51:07Z')
  assert.equal(out.data_commit, null) // fixture dir is not a git checkout
  assert.equal(out.weeks['2026-W46'].workflows['loop-station-refresh.yml'].rate, 1)
  assert.equal(out.weeks['2026-W46'].schedules['weekly.yml'].total, 2)
})

test('lines.json lists every workflow exactly once', () => {
  const lines = JSON.parse(readFileSync(join(HERE, 'lines.json'), 'utf8')).lines
  const mapped = Object.values(lines).flat()
  assert.equal(new Set(mapped).size, mapped.length, 'a workflow is listed twice')
  const dir = join(HERE, '..', '..', '.github', 'workflows')
  const files = readdirSync(dir).filter(f => f.endsWith('.yml')).sort()
  assert.deepEqual([...mapped].sort(), files)
})

test('in a git checkout, committing latest.json does not change data_commit or the bytes', async () => {
  const { execFileSync } = await import('node:child_process')
  const d = fixtureDir()
  const g = (...a) => execFileSync('git', ['-C', d, '-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { encoding: 'utf8' })
  g('init', '-q')
  g('add', '.')
  g('commit', '-q', '-m', 'data')
  runRollup(d)
  const one = readFileSync(join(d, 'metrics', 'latest.json'), 'utf8')
  g('add', '.')
  g('commit', '-q', '-m', 'rollup')
  const out = runRollup(d)
  assert.ok(out.data_commit)
  assert.equal(one, readFileSync(join(d, 'metrics', 'latest.json'), 'utf8'))
  assert.equal(g('status', '--porcelain').trim(), '')
})
