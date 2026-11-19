// The Clock tab (#4216): for each clock job, when it was last due, whether the clock ran it in that
// slot and how the run ended, and when it is due next. Pure — the endpoint feeds it GitHub's runs list.
// "Due" has one definition: `dueJobs` (clock-jobs.ts). lastDue / nextDue walk 10-minute slots with it.
import { dueJobs, type ClockJob } from './clock-jobs'
import type { CardsSyncRecord } from './cards-sync-clock'

const SLOT_MS = 10 * 60_000
/** A clock run must be created within this long after the slot start; also the grace before "missed". */
export const GRACE_MS = 20 * 60_000
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
  /** The inbox stuck check's row has only `createdAt` (it is no workflow run). */
  lastRun: (Partial<LastRun> & { createdAt: string }) | null
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

/** How a slot's clock run ended: still going, ok (success / skipped), or failed. */
const runState = (r: GhRun): ClockState => {
  if (r.status !== 'completed') return 'running'
  return r.conclusion === 'success' || r.conclusion === 'skipped' ? 'ok' : 'failed'
}

/**
 * For a cancelled clock run: the run of the same workflow created within GRACE_MS after it that took its place —
 * the earliest success (ok), else one still going (running). Null when there is none, or `replacedBy` is not given.
 */
function replacement(inSlot: GhRun, replacedBy?: GhRun[]): { run: GhRun, state: ClockState } | null {
  if (!replacedBy || inSlot.status !== 'completed' || inSlot.conclusion !== 'cancelled') return null
  const start = Date.parse(inSlot.created_at)
  const later = replacedBy
    .filter((r) => {
      const t = Date.parse(r.created_at)
      return r.id !== inSlot.id && t >= start && t <= start + GRACE_MS
    })
    .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at))
  const won = later.find(r => r.status === 'completed' && r.conclusion === 'success')
  if (won) return { run: won, state: 'ok' }
  const pending = later.find(r => r.status !== 'completed')
  return pending ? { run: pending, state: 'running' } : null
}

/**
 * Whether the clock ran `job` in its last due slot, and how that run ended. Never green on a missed slot or a failed run;
 * a cancelled run replaced by a later success counts as ran (`replacedBy`: runs of the same workflow, any actor/event).
 */
export function jobStatus(job: ClockJob, now: Date, runs: GhRun[], workflowName: string, replacedBy?: GhRun[]): JobStatus {
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
    const replaced = replacement(inSlot, replacedBy)
    if (replaced) return { ...base, lastRun: toLastRun(replaced.run), state: replaced.state }
    return { ...base, lastRun: toLastRun(inSlot), state: runState(inSlot) }
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

/** When the inbox stuck check moved to the clock (#4234): before it, with no record, the row is grey. */
export const CARDS_SYNC_SINCE = '2026-11-19T16:00:00Z'
const SYNC_SLOT_MS = 30 * 60_000
/** A clock sync record older than this is a miss (one :00/:30 slot + 10 min of grace). */
const SYNC_FRESH_MS = 40 * 60_000

/**
 * The Clock tab's 14th row: the inbox stuck check, built from the clock sync's KV record
 * (`clock:cards-sync:last`), not from a workflow's runs. `clockOn` = this Worker has CLOCK_ENABLED=1;
 * without it no record can arrive, so no record is "not on the clock yet", never a miss.
 */
export function cardsSyncStatus(record: CardsSyncRecord | null, now: Date, clockOn: boolean): JobStatus {
  const slot = Math.floor(now.getTime() / SYNC_SLOT_MS) * SYNC_SLOT_MS
  const base = {
    workflow: 'inbox stuck check',
    schedule: 'every 30 min',
    about: 'Checks GitHub for stuck tickets, idle drafts and other things waiting on you, and updates the inbox — even when you haven\'t opened it.',
    lastDue: new Date(slot).toISOString(),
    nextDue: new Date(slot + SYNC_SLOT_MS).toISOString(),
    lastRun: record ? { createdAt: record.at } : null,
    error: record?.ok ? (record.readErrors ?? null) : (record?.error ?? null)
  }
  if (!record && (!clockOn || now.getTime() < Date.parse(CARDS_SYNC_SINCE) + SYNC_FRESH_MS)) return { ...base, state: 'before-clock' }
  if (record && !record.ok) return { ...base, state: 'failed' }
  if (!record || now.getTime() - Date.parse(record.at) > SYNC_FRESH_MS) return { ...base, state: 'missed' }
  return { ...base, state: 'ok' }
}

/** A GitHub read error in words the owner can act on (403 = the status token lacks Actions: read). */
export function readError(error: string): string {
  return /GitHub 403\b/.test(error) ? 'the status token needs Actions: read' : error
}
