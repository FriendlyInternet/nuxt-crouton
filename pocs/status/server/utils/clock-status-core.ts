// The Clock tab (#4216): for each clock job, when it was last due, whether the clock ran it in that
// slot and how the run ended, and when it is due next. Pure — the endpoint feeds it GitHub's runs list.
// "Due" has one definition: `dueJobs` (clock-jobs.ts). lastDue / nextDue walk 10-minute slots with it.
import { dueJobs, type ClockJob } from './clock-jobs'

const SLOT_MS = 10 * 60_000
/** A clock run must be created within this long after the slot start; also the grace before "missed". */
const GRACE_MS = 20 * 60_000
/** Month jobs repeat at most every 31 days; 32 days of slots covers every job. */
const MAX_SLOTS = 32 * 24 * 6
const CLOCK_ACTOR = 'nuxt-harness[bot]'

export type ClockState = 'ok' | 'running' | 'failed' | 'missed' | 'due' | 'before-clock' | 'unknown'

/** The fields of a GitHub workflow run the Clock tab reads (`/actions/workflows/<wf>/runs`). */
export interface GhRun {
  id: number
  html_url: string
  event: string
  status: string | null
  conclusion: string | null
  created_at: string
  display_title?: string | null
  actor?: { login?: string | null } | null
}

export interface LastRun { id: number, url: string, createdAt: string, status: string | null, conclusion: string | null }

export interface JobStatus {
  workflow: string
  schedule: string
  about: string
  lastDue: string | null
  nextDue: string | null
  lastRun: LastRun | null
  state: ClockState
  error?: string | null
}

const slotStart = (t: number) => Math.floor(t / SLOT_MS) * SLOT_MS
const isDue = (job: ClockJob, t: number) => dueJobs(new Date(t), [job]).length > 0

/** Start of the most recent 10-minute slot (the current one included) in which `job` is due. */
export function lastDue(job: ClockJob, now: Date): Date | null {
  const first = slotStart(now.getTime())
  for (let i = 0; i <= MAX_SLOTS; i++) {
    const t = first - i * SLOT_MS
    if (isDue(job, t)) return new Date(t)
  }
  return null
}

/** Start of the next 10-minute slot (after the current one) in which `job` is due. */
export function nextDue(job: ClockJob, now: Date): Date | null {
  const first = slotStart(now.getTime()) + SLOT_MS
  for (let i = 0; i <= MAX_SLOTS; i++) {
    const t = first + i * SLOT_MS
    if (isDue(job, t)) return new Date(t)
  }
  return null
}

const WEEKDAYS = ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays']
const pad = (n: number) => String(n).padStart(2, '0')
const ordinal = (n: number) => {
  const s = n % 100 >= 11 && n % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th'
  return `${n}${s}`
}

/** The job's timing in plain words, e.g. "every hour, :10–:20" or "daily 06:30 UTC". */
export function scheduleWords(job: ClockJob): string {
  const time = `${pad(job.hour ?? 0)}:${pad(job.minute)} UTC`
  if (job.every === 'hour') {
    const start = Math.floor(job.minute / 10) * 10
    return `every hour, :${pad(start)}–:${pad(start + 10)}`
  }
  if (job.every === 'week') return `${WEEKDAYS[job.weekday ?? 0]} ${time}`
  if (job.every === 'month') return `${ordinal(job.day ?? 1)} of the month ${time}`
  return `daily ${time}`
}

/**
 * A run the clock started: a `workflow_dispatch` by the Harness App whose title is the workflow's own
 * name. The bot's hand-off dispatches (e.g. `automerge #<pr>`) set their own run-name, so they don't count.
 */
export function isClockRun(run: GhRun, workflowName: string): boolean {
  return run.event === 'workflow_dispatch'
    && run.actor?.login === CLOCK_ACTOR
    && (run.display_title ?? '') === workflowName
}

const toLastRun = (r: GhRun): LastRun => ({ id: r.id, url: r.html_url, createdAt: r.created_at, status: r.status, conclusion: r.conclusion })

/** Whether the clock ran `job` in its last due slot, and how that run ended. Never green on a missed slot or a failed run. */
export function jobStatus(job: ClockJob, now: Date, runs: GhRun[], workflowName: string): JobStatus {
  const due = lastDue(job, now)
  const next = nextDue(job, now)
  const clockRuns = runs
    .filter(r => isClockRun(r, workflowName))
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
  const base = {
    workflow: job.workflow,
    schedule: scheduleWords(job),
    about: job.about,
    lastDue: due?.toISOString() ?? null,
    nextDue: next?.toISOString() ?? null,
    lastRun: clockRuns[0] ? toLastRun(clockRuns[0]) : null
  }
  if (!due) return { ...base, state: 'unknown' }

  const from = due.getTime()
  const inSlot = clockRuns.find((r) => {
    const t = Date.parse(r.created_at)
    return t >= from && t < from + GRACE_MS
  })
  if (inSlot) {
    const state: ClockState = inSlot.status !== 'completed'
      ? 'running'
      : inSlot.conclusion === 'success' || inSlot.conclusion === 'skipped' ? 'ok' : 'failed'
    return { ...base, lastRun: toLastRun(inSlot), state }
  }
  // A slot from before the job moved to the clock, and no clock run since then: not the clock's miss.
  const since = Date.parse(job.since)
  if (from < since && !clockRuns.some(r => Date.parse(r.created_at) >= since)) return { ...base, state: 'before-clock' }
  return { ...base, state: now.getTime() - from > GRACE_MS ? 'missed' : 'due' }
}

/** The row for a job whose GitHub read failed: state unknown, with the reason. */
export function unknownStatus(job: ClockJob, now: Date, error: string): JobStatus {
  return {
    workflow: job.workflow,
    schedule: scheduleWords(job),
    about: job.about,
    lastDue: lastDue(job, now)?.toISOString() ?? null,
    nextDue: nextDue(job, now)?.toISOString() ?? null,
    lastRun: null,
    state: 'unknown',
    error
  }
}

/** A GitHub read error in words the owner can act on (403 = the status token lacks Actions: read). */
export function readError(error: string): string {
  return /GitHub 403\b/.test(error) ? 'the status token needs Actions: read' : error
}
