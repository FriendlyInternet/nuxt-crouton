#!/usr/bin/env node
// rollup.mjs — turn the stored run/job history into metrics/latest.json (#3679).
// No network, no clock: `as_of` is the newest run in the data, so the same data gives
// byte-identical output. Reads <data>/metrics/{runs,jobs,schedules}/.
import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const DAY = 86400000
const SLOT_GRACE = 2 * 3600000
const FAIL = new Set(['failure', 'timed_out'])
const COUNTED = new Set(['success', 'failure', 'timed_out'])

/** JSON with object keys sorted recursively (arrays keep order). */
export function stable(v) {
  if (Array.isArray(v)) return v.map(stable)
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map(k => [k, stable(v[k])]))
  return v
}

/** ISO week key (Mon–Sun, UTC) for an ISO timestamp or ms, e.g. `2026-W46`. */
export function isoWeek(t) {
  const d = new Date(typeof t === 'number' ? t : Date.parse(t))
  const day = (d.getUTCDay() + 6) % 7 // Mon=0
  const thu = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day + 3))
  const y = thu.getUTCFullYear()
  const jan1 = Date.UTC(y, 0, 1)
  const wk = Math.floor((thu.getTime() - jan1) / DAY / 7) + 1
  return `${y}-W${String(wk).padStart(2, '0')}`
}

function parseRange(range, stepS, min, max) {
  if (range === '*') return [min, max]
  const [a, b] = range.split('-')
  const lo = Number(a)
  return [lo, b === undefined ? (stepS ? max : lo) : Number(b)]
}

function parseField(f, min, max) {
  const out = new Set()
  for (const part of f.split(',')) {
    const [range, stepS] = part.split('/')
    const step = stepS ? Number(stepS) : 1
    const [lo, hi] = parseRange(range, stepS, min, max)
    for (let v = lo; v <= hi; v += step) out.add(v)
  }
  return out
}

/** Predicate over a Date for a 5-field cron (vixie day-of-month/day-of-week OR rule). */
function cronMatcher(expr) {
  const f = expr.trim().split(/\s+/)
  if (f.length !== 5) throw new Error(`bad cron: ${expr}`)
  const min = parseField(f[0], 0, 59), hour = parseField(f[1], 0, 23)
  const dom = parseField(f[2], 1, 31), mon = parseField(f[3], 1, 12)
  const dow = new Set([...parseField(f[4], 0, 7)].map(v => v % 7))
  const bothDays = f[2] === '*' || f[4] === '*'
  return (d) => {
    if (!min.has(d.getUTCMinutes()) || !hour.has(d.getUTCHours()) || !mon.has(d.getUTCMonth() + 1)) return false
    const domOk = dom.has(d.getUTCDate()), dowOk = dow.has(d.getUTCDay())
    return bothDays ? domOk && dowOk : domOk || dowOk
  }
}

/** Slots (ms, UTC) of a 5-field cron in [fromMs, toMs). Supports `*`, lists, ranges, steps. */
export function expandCron(expr, fromMs, toMs) {
  const matches = cronMatcher(expr)
  const out = []
  for (let t = Math.ceil(fromMs / 60000) * 60000; t < toMs; t += 60000) {
    if (matches(new Date(t))) out.push(t)
  }
  return out
}

const rate = (failed, runs) => (runs ? Math.round((failed / runs) * 10000) / 10000 : null)
const bump = (obj, key, failed) => {
  const e = (obj[key] ??= { runs: 0, failed: 0 })
  e.runs++
  if (failed) e.failed++
}
const finish = (obj) => { for (const e of Object.values(obj)) e.rate = rate(e.failed, e.runs) }

const newWeek = () => ({ slots: 0, missed: 0, failed_runs: 0, total: 0 })

/** All cron slots (ms, ascending) for a workflow, using the schedule snapshot in force each day. */
function slotsFor(wf, snapshots, firstMs, asOfMs) {
  const slots = []
  for (let d = Math.floor(firstMs / DAY) * DAY; d <= asOfMs; d += DAY) {
    const date = new Date(d).toISOString().slice(0, 10)
    const snap = [...snapshots].reverse().find(s => s.date <= date) || snapshots[0]
    const set = new Set()
    for (const c of snap?.map[wf] || []) for (const s of expandCron(c, d, d + DAY)) set.add(s)
    slots.push(...set)
  }
  return slots.sort((a, b) => a - b)
}

/** Slots → { weekKey: {slots, missed} } and schedule runs → failed_runs, per workflow. */
function scheduleStats(wf, runs, snapshots, firstMs, asOfMs) {
  const sched = runs.filter(r => r.event === 'schedule' && r.started).sort((a, b) => Date.parse(a.started) - Date.parse(b.started))
  const used = new Set()
  const weeks = {}
  for (const s of slotsFor(wf, snapshots, firstMs, asOfMs)) {
    if (s + SLOT_GRACE > asOfMs) continue // not judgeable yet
    const w = (weeks[isoWeek(s)] ??= newWeek())
    w.slots++
    const hit = sched.findIndex((r, i) => !used.has(i) && Date.parse(r.started) >= s && Date.parse(r.started) < s + SLOT_GRACE)
    if (hit >= 0) used.add(hit)
    else w.missed++
  }
  for (const r of sched) {
    if (!r.conclusion || r.conclusion === 'success' || r.conclusion === 'skipped') continue
    ;(weeks[isoWeek(r.created)] ??= newWeek()).failed_runs++
  }
  for (const w of Object.values(weeks)) w.total = w.missed + w.failed_runs
  return weeks
}

const newWeekBucket = () => ({ workflows: {}, jobs: {}, jobs_coverage: { eligible_runs: 0, runs_with_jobs: 0 }, schedules: {}, lines: {} })

function tallyRuns(runs, jobs, wk) {
  const withJobs = new Set(jobs.map(j => `${j.run_id}:${j.attempt}`))
  for (const r of runs) {
    const w = wk(isoWeek(r.created))
    if (COUNTED.has(r.conclusion)) bump(w.workflows, r.workflow, FAIL.has(r.conclusion))
    if (r.status === 'completed' && r.conclusion !== 'skipped') {
      w.jobs_coverage.eligible_runs++
      if (withJobs.has(`${r.id}:${r.attempt}`)) w.jobs_coverage.runs_with_jobs++
    }
  }
}

function tallyJobs(runs, jobs, wk) {
  const byRun = new Map(runs.map(r => [r.id, r]))
  for (const line of jobs) {
    const r = byRun.get(line.run_id)
    if (!r || r.attempt !== line.attempt) continue
    const w = wk(isoWeek(r.created))
    for (const j of line.jobs) if (COUNTED.has(j.conclusion)) bump(w.jobs, `${r.workflow}/${j.name}`, FAIL.has(j.conclusion))
  }
}

function tallySchedules(runs, snaps, asOfMs, weeks, wk) {
  const byWf = new Map()
  for (const r of runs) (byWf.get(r.workflow) ?? byWf.set(r.workflow, []).get(r.workflow)).push(r)
  const scheduled = new Set(snaps.flatMap(s => Object.keys(s.map)))
  for (const wf of [...scheduled].sort()) {
    const rs = byWf.get(wf) || []
    if (!rs.length) continue
    const firstMs = Math.min(...rs.map(r => Date.parse(r.created)))
    for (const [k, v] of Object.entries(scheduleStats(wf, rs, snaps, firstMs, asOfMs))) if (weeks[k]) wk(k).schedules[wf] = v
  }
}

function tallyLines(weeks, lines) {
  const lineOf = new Map()
  for (const [l, wfs] of Object.entries(lines)) for (const f of wfs) lineOf.set(f, l)
  const bucket = (acc, f) => (acc[lineOf.get(f) || 'unmapped'] ??= { runs: 0, failed: 0, schedule_total: 0 })
  for (const w of Object.values(weeks)) {
    finish(w.workflows); finish(w.jobs)
    const acc = Object.fromEntries(Object.keys(lines).map(l => [l, { runs: 0, failed: 0, schedule_total: 0 }]))
    for (const [f, e] of Object.entries(w.workflows)) { const l = bucket(acc, f); l.runs += e.runs; l.failed += e.failed }
    for (const [f, s] of Object.entries(w.schedules)) bucket(acc, f).schedule_total += s.total
    for (const [l, e] of Object.entries(acc)) w.lines[l] = { workflow_rate: rate(e.failed, e.runs), runs: e.runs, failed: e.failed, schedule_total: e.schedule_total }
  }
}

/**
 * Pure. runs: run rows; jobs: {run_id, attempt, jobs[]} lines; schedules: [{date, map}] ascending;
 * lines: {line: [workflow.yml…]}.
 */
export function rollup({ runs, jobs, schedules = [], lines, dataCommit = null, asOf = null }) {
  const sortedSnaps = [...schedules].sort((a, b) => (a.date < b.date ? -1 : 1))
  const asOfIso = asOf || runs.reduce((m, r) => (r.created > m ? r.created : m), '') || null
  const asOfMs = asOfIso ? Date.parse(asOfIso) : 0
  const weeks = {}
  const wk = (k) => (weeks[k] ??= newWeekBucket())
  tallyRuns(runs, jobs, wk)
  tallyJobs(runs, jobs, wk)
  tallySchedules(runs, sortedSnaps, asOfMs, weeks, wk)
  tallyLines(weeks, lines)
  return stable({ data_commit: dataCommit, as_of: asOfIso, weeks })
}

export const serialize = (obj) => `${JSON.stringify(stable(obj), null, 2)}\n`

const readLines = (p) => readFileSync(p, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l))
const listFiles = (d, ext) => (existsSync(d) ? readdirSync(d).filter(f => f.endsWith(ext)).sort() : [])

/** Load everything under <data>/metrics. */
export function loadData(dataDir) {
  const m = join(dataDir, 'metrics')
  const runs = listFiles(join(m, 'runs'), '.jsonl').flatMap(f => readLines(join(m, 'runs', f)))
  const jobs = listFiles(join(m, 'jobs'), '.jsonl').flatMap(f => readLines(join(m, 'jobs', f)))
  const schedules = listFiles(join(m, 'schedules'), '.json').map(f => ({ date: f.slice(0, -5), map: JSON.parse(readFileSync(join(m, 'schedules', f), 'utf8')) }))
  return { runs, jobs, schedules }
}

function gitHead(dir) {
  try { return execFileSync('git', ['-C', dir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() } catch { return null }
}

export function runRollup(dataDir, linesPath = join(HERE, 'lines.json')) {
  const lines = JSON.parse(readFileSync(linesPath, 'utf8')).lines
  const out = rollup({ ...loadData(dataDir), lines, dataCommit: gitHead(dataDir) })
  mkdirSync(join(dataDir, 'metrics'), { recursive: true })
  writeFileSync(join(dataDir, 'metrics', 'latest.json'), serialize(out))
  return out
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const i = process.argv.indexOf('--data')
  if (i < 0) { console.error('usage: rollup.mjs --data <dir>'); process.exit(2) }
  const out = runRollup(process.argv[i + 1])
  console.log(`::notice::rollup: ${Object.keys(out.weeks).length} weeks, as_of ${out.as_of}, data_commit ${out.data_commit}`)
}
