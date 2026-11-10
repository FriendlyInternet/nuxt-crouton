#!/usr/bin/env node
// collect.mjs — copy workflow-run and job history from the GitHub API into files in a
// checkout of the `pipeline-data` branch (#3679). It copies facts and computes nothing.
//
//   metrics/runs/<day>.jsonl       one run row per line (day = run's created date, UTC)
//   metrics/jobs/<day>.jsonl       one line per run: {run_id, attempt, jobs:[…]}
//   metrics/schedules/<day>.json   {workflow.yml: [cron…]} from main's workflow files
//   metrics/state.json             {runs_fetched_at:{day:iso}} — fetch bookkeeping only
//
// Runs hourly and resumes: jobs lines are merged to disk after every batch, and the run
// stops cleanly when the call budget, the time budget or the rate-limit reserve is reached.
// History starts from today (no backfill, #3723); one call that does not answer within its
// time limit stops the run like any failed call.
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs'
import { join, basename } from 'node:path'
import { pathToFileURL } from 'node:url'
import { fetchAllPages } from '../lib/gh-paginate.mjs'
import { readRateLimit } from '../lib/rate-limit.mjs'

const DAY = 86400000
export const WINDOW_CAP = 1000
const BATCH = 100

const iso = (sec) => new Date(sec * 1000).toISOString().replace('.000Z', 'Z')
const dayOf = (t) => new Date(t).toISOString().slice(0, 10)

/** Allow-listed run fields only: no actor, titles, messages or emails. */
export function toRunRow(r) {
  return {
    id: r.id, attempt: r.run_attempt ?? 1, workflow: basename(r.path || r.name || ''), event: r.event,
    branch: r.head_branch ?? null, sha: r.head_sha ?? null,
    prs: (r.pull_requests || []).map(p => p.number).filter(Number.isFinite),
    created: r.created_at, started: r.run_started_at ?? null, ended: r.updated_at ?? null,
    status: r.status, conclusion: r.conclusion ?? null,
  }
}

export function toJobRow(j) {
  const failed = (j.steps || []).find(s => s.conclusion === 'failure')
  return { name: j.name, started: j.started_at ?? null, ended: j.completed_at ?? null, conclusion: j.conclusion ?? null, failed_step: failed ? failed.name : null }
}

/**
 * Split [from,to] (epoch seconds, inclusive) until each piece has < WINDOW_CAP runs
 * (the list returns at most 1000 per filtered query). Pieces touch with no gap or overlap.
 * @param {{from:number,to:number}} win @param {(fromIso:string,toIso:string)=>Promise<number>} countFn
 */
export async function splitWindow(win, countFn) {
  const n = await countFn(iso(win.from), iso(win.to))
  if (n < WINDOW_CAP || win.to - win.from < 60) return [win]
  const mid = Math.floor((win.from + win.to) / 2)
  return [...await splitWindow({ from: win.from, to: mid }, countFn), ...await splitWindow({ from: mid + 1, to: win.to }, countFn)]
}

/** Days to (re)fetch: never fetched, or not final and last fetched >6h ago. Final = fetched >48h after the day ended. */
export function selectRunDays({ nowMs, fetchedAt, days = 1 }) {
  const out = []
  const today = Math.floor(nowMs / DAY) * DAY
  for (let d = today - days * DAY; d <= today; d += DAY) {
    const day = dayOf(d), at = fetchedAt[day] ? Date.parse(fetchedAt[day]) : null
    if (at === null) out.push(day)
    else if (at <= d + DAY + 2 * DAY && nowMs - at > 6 * 3600000) out.push(day)
  }
  return out
}

/** Completed, non-skipped runs with no jobs line for their current attempt, oldest day first. */
export function jobsWorkList(runsByDay, jobsByDay) {
  const work = []
  for (const day of Object.keys(runsByDay).sort()) {
    const have = new Set((jobsByDay[day] || []).map(l => `${l.run_id}:${l.attempt}`))
    for (const r of [...runsByDay[day]].sort((a, b) => a.id - b.id)) {
      if (r.status === 'completed' && r.conclusion !== 'skipped' && !have.has(`${r.id}:${r.attempt}`)) work.push({ day, run: r })
    }
  }
  return work
}

/** How many lookups this run may still make. */
function planBatch(pending, { remaining, reserve, used, maxCalls }) {
  const room = Math.min(maxCalls - used, remaining === null ? Infinity : remaining - reserve)
  return Math.max(0, Math.min(pending, room))
}

export function parseCrons(text) {
  return [...text.matchAll(/^\s*-\s*cron:\s*['"]([^'"]+)['"]/gm)].map(m => m[1])
}

const readJsonl = (p) => (existsSync(p) ? readFileSync(p, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : [])
const writeJsonl = (p, rows) => writeFileSync(p, rows.map(r => `${JSON.stringify(r)}\n`).join(''))

const sortByName = (x, y) => (x.name < y.name ? -1 : x.name > y.name ? 1 : 0)

/** Write today's cron snapshot from the workflow files (once a day). */
function snapshotSchedules(o, m, today) {
  const schedPath = join(m, 'schedules', `${today}.json`)
  if (!o.workflowsDir || existsSync(schedPath)) return
  const map = {}
  for (const f of readdirSync(o.workflowsDir).filter(f => f.endsWith('.yml')).sort()) {
    const crons = parseCrons(readFileSync(join(o.workflowsDir, f), 'utf8'))
    if (crons.length) map[f] = crons
  }
  writeFileSync(schedPath, `${JSON.stringify(map)}\n`)
}

/** Fetch every run in one UTC day (split into windows under the 1000-row cap) and write it. */
async function fetchRunDay(ctx, day) {
  const { api, m } = ctx
  const from = Date.parse(`${day}T00:00:00Z`) / 1000
  const count = async (a, b) => (await api(`/actions/runs?created=${a}..${b}&per_page=1`)).json.total_count ?? 0
  const rows = new Map()
  for (const w of await splitWindow({ from, to: from + 86399 }, count)) {
    const { items } = await fetchAllPages(async (u) => {
      const r = await api(u)
      return { data: r.json.workflow_runs, link: r.headers?.link }
    }, `/actions/runs?created=${iso(w.from)}..${iso(w.to)}&per_page=100`, { maxPages: 10 })
    for (const r of items) rows.set(r.id, toRunRow(r))
  }
  writeJsonl(join(m, 'runs', `${day}.jsonl`), [...rows.values()].sort((a, b) => a.id - b.id))
  return rows.size
}

async function fetchRuns(ctx, o, state) {
  const { st, nowMs, overBudget } = ctx
  try {
    for (const day of selectRunDays({ nowMs, fetchedAt: state.runs_fetched_at, days: o.days ?? 1 })) {
      if (overBudget()) break
      const n = await fetchRunDay(ctx, day)
      state.runs_fetched_at[day] = new Date(nowMs).toISOString()
      st.runsDays++
      ctx.log(`collect: ${day} runs ${n} fetched, calls used ${st.used}`)
    }
  } catch (e) { st.error = String(e.message || e); st.stopReason = `error: ${st.error}` }
}

/** Jobs for one run; a run whose jobs are gone (404/410) records an empty list. */
async function fetchJobsFor(ctx, run) {
  try {
    const { items } = await fetchAllPages(async (u) => {
      const r = await ctx.api(u)
      return { data: r.json.jobs, link: r.headers?.link }
    }, `/actions/runs/${run.id}/attempts/${run.attempt}/jobs?per_page=100`, { maxPages: 5 })
    return items.map(toJobRow).sort(sortByName)
  } catch (e) {
    if (e.status !== 404 && e.status !== 410) throw e
    return []
  }
}

/** Merge a batch of new jobs lines into the per-day files. */
function flushBatch(ctx, jobsByDay, batch) {
  for (const day of new Set(batch.map(b => b.day))) {
    const add = batch.filter(b => b.day === day).map(b => b.line)
    const ids = new Set(add.map(l => l.run_id))
    jobsByDay[day] = [...(jobsByDay[day] || []).filter(l => !ids.has(l.run_id)), ...add].sort((a, b) => a.run_id - b.run_id)
    writeJsonl(join(ctx.m, 'jobs', `${day}.jsonl`), jobsByDay[day])
  }
  ctx.st.jobsAdded += batch.length
}

/**
 * Fill the jobs work list batch by batch, one progress line per finished (or stopped) day;
 * returns how many runs were handled.
 */
async function fetchJobs(ctx, work, jobsByDay, runsByDay) {
  const { st, overBudget } = ctx
  let i = 0, cur = work[0]?.day, touched = false
  const progress = (day) => ctx.log(`collect: ${day} runs ${(runsByDay[day] || []).length}, jobs ${(jobsByDay[day] || []).length}, calls used ${st.used}`)
  try {
    while (i < work.length && !overBudget()) {
      const batch = []
      try {
        while (batch.length < BATCH && i < work.length && work[i].day === cur && !overBudget()) {
          const { day, run } = work[i]
          touched = true
          batch.push({ day, line: { run_id: run.id, attempt: run.attempt, jobs: await fetchJobsFor(ctx, run) } })
          i++
        }
      } finally { flushBatch(ctx, jobsByDay, batch) }
      if (i >= work.length || work[i].day !== cur) { progress(cur); touched = false; cur = work[i]?.day }
    }
  } catch (e) { st.error = String(e.message || e); st.stopReason = `error: ${st.error}` }
  if (touched) progress(cur)
  return i
}

function loadDays(m) {
  const runsByDay = {}, jobsByDay = {}
  for (const f of readdirSync(join(m, 'runs')).filter(f => f.endsWith('.jsonl')).sort()) {
    const day = f.slice(0, -6)
    runsByDay[day] = readJsonl(join(m, 'runs', f))
    jobsByDay[day] = readJsonl(join(m, 'jobs', f))
  }
  return { runsByDay, jobsByDay }
}

function makeCtx(o, m, nowMs, log) {
  const maxCalls = o.maxCalls ?? 1500, reserve = o.reserve ?? 1500
  const maxMs = o.maxMs ?? 20 * 60000, callTimeoutMs = o.callTimeoutMs ?? 30000
  const clock = o.clock || Date.now
  const start = clock()
  const st = { used: 0, remaining: o.remaining ?? null, runsDays: 0, jobsAdded: 0, error: null, stopReason: null }
  const api = async (path) => {
    st.used++
    const url = path.startsWith('http') ? path : `/repos/${o.repo}${path}`
    // Race the call against its own timer, so even a fetch that ignores the signal is cut off.
    let timer
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`timeout after ${callTimeoutMs / 1000}s ${path}`)), callTimeoutMs)
    })
    let res
    try {
      res = await Promise.race([o.fetchImpl(url, { signal: AbortSignal.timeout(callTimeoutMs) }), timeout])
    } finally { clearTimeout(timer) }
    const rem = Number(res.headers?.['x-ratelimit-remaining'])
    if (Number.isFinite(rem)) st.remaining = rem
    if (res.status >= 400) throw Object.assign(new Error(`HTTP ${res.status} ${path}`), { status: res.status })
    return res
  }
  const overBudget = () => {
    if (planBatch(1, { remaining: st.remaining, reserve, used: st.used, maxCalls }) < 1) {
      st.stopReason ??= st.used >= maxCalls ? 'call budget' : 'rate-limit reserve'
    } else if (clock() - start >= maxMs) st.stopReason ??= 'time budget'
    else return false
    return true
  }
  return { st, api, overBudget, m, nowMs, log }
}

/**
 * @param {{ data:string, workflowsDir?:string, repo:string,
 *   fetchImpl:(url:string, init?:{signal?:AbortSignal})=>Promise<{status:number,headers:Record<string,string>,json:any}>,
 *   nowMs?:number, maxCalls?:number, reserve?:number, remaining?:number|null, days?:number,
 *   maxMs?:number, callTimeoutMs?:number, clock?:()=>number, log?:(s:string)=>void }} o
 */
export async function collect(o) {
  const nowMs = o.nowMs ?? Date.now()
  const log = o.log || console.log
  const m = join(o.data, 'metrics')
  for (const d of ['runs', 'jobs', 'schedules']) mkdirSync(join(m, d), { recursive: true })
  const statePath = join(m, 'state.json')
  const state = existsSync(statePath) ? JSON.parse(readFileSync(statePath, 'utf8')) : {}
  state.runs_fetched_at ??= {}
  const ctx = makeCtx(o, m, nowMs, log)
  const { st } = ctx

  snapshotSchedules(o, m, dayOf(nowMs))
  await fetchRuns(ctx, o, state)
  writeFileSync(statePath, `${JSON.stringify(state)}\n`)

  const { runsByDay, jobsByDay } = loadDays(m)
  const work = jobsWorkList(runsByDay, jobsByDay)
  const done = st.error ? 0 : await fetchJobs(ctx, work, jobsByDay, runsByDay)
  const pending = work.length - done
  const oldest = pending ? work[done].day : 'none'
  log(`::notice::collect: runs days written ${st.runsDays}, jobs lines added ${st.jobsAdded}, jobs pending ${pending} (oldest pending day ${oldest}), calls used ${st.used}, stopped: ${st.stopReason || 'done'}`)
  return { ...st, pending, oldestPending: oldest }
}

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : def
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const token = process.env.GH_TOKEN, repo = process.env.REPO
  if (!token || !repo) { console.error('GH_TOKEN and REPO are required'); process.exit(2) }
  const base = process.env.GITHUB_API_URL || 'https://api.github.com'
  const fetchImpl = async (u, init = {}) => {
    const res = await fetch(u.startsWith('http') ? u : `${base}${u}`, {
      signal: init.signal,
      headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28' },
    })
    const headers = {}
    res.headers.forEach((v, k) => { headers[k.toLowerCase()] = v })
    let json = null
    try { json = await res.json() } catch { /* empty body */ }
    return { status: res.status, headers, json }
  }
  const rl = await readRateLimit(token)
  const out = await collect({
    data: arg('data'), workflowsDir: arg('workflows'), repo, fetchImpl,
    maxCalls: Number(arg('max-calls', 1500)), remaining: 'remaining' in rl ? rl.remaining : null,
    days: Number(arg('days', 1)), maxMs: Number(arg('max-minutes', 20)) * 60000,
    callTimeoutMs: Number(arg('call-timeout-seconds', 30)) * 1000,
  })
  if (out.error && !out.runsDays && !out.jobsAdded) process.exit(1)
}
