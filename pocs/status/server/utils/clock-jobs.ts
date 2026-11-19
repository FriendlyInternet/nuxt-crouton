// The status app's clock (#4133): which workflow is due in which 10-minute slot.
// Pure, no storage — a slot whose tick never arrives is skipped (no catch-up, by design).
// To add a job: add a row here, give the workflow `workflow_dispatch` with a boolean `clock` input,
// make any manual-only branch check `!inputs.clock`, and remove its `schedule:`.
// Times are UTC, as cron. `weekday` uses cron numbering (0 = Sunday, 1 = Monday).

export interface ClockJob {
  workflow: string
  every: 'hour' | 'day' | 'week' | 'month'
  minute: number
  /** day / week / month jobs: the UTC hour. */
  hour?: number
  /** week jobs: 0 = Sunday … 6 = Saturday. */
  weekday?: number
  /** month jobs: day of the month (1–31). */
  day?: number
}

export const CLOCK_JOBS: ClockJob[] = [
  { workflow: 'automerge-epic-subpr.yml', every: 'hour', minute: 17 },
  { workflow: 'pipeline-metrics.yml', every: 'hour', minute: 23 },
  { workflow: 'handoff-sweep.yml', every: 'hour', minute: 41 },
  { workflow: 'e2e.yml', every: 'day', hour: 4, minute: 0 },
  { workflow: 'epic-digest.yml', every: 'day', hour: 5, minute: 0 },
  { workflow: 'label-ready-epics.yml', every: 'day', hour: 5, minute: 0 },
  { workflow: 'skills-digest.yml', every: 'month', day: 1, hour: 5, minute: 0 },
  { workflow: 'housekeeping.yml', every: 'day', hour: 6, minute: 0 },
  { workflow: 'sync-changelogs.yml', every: 'day', hour: 6, minute: 0 },
  { workflow: 'quality-digest.yml', every: 'day', hour: 6, minute: 30 },
  { workflow: 'weekly.yml', every: 'week', weekday: 1, hour: 6, minute: 30 },
  { workflow: 'pipeline-review.yml', every: 'day', hour: 6, minute: 45 },
  { workflow: 'pi-key-canary.yml', every: 'day', hour: 7, minute: 0 }
]

/** Jobs whose time falls in the 10-minute slot that contains `slot` (UTC): [slotStart, slotStart + 10). */
export function dueJobs(slot: Date, jobs: ClockJob[] = CLOCK_JOBS): ClockJob[] {
  const start = Math.floor(slot.getUTCMinutes() / 10) * 10
  return jobs.filter((j) => {
    if (!(j.minute >= start && j.minute < start + 10)) return false
    if (j.every === 'hour') return true
    if (j.hour !== slot.getUTCHours()) return false
    if (j.every === 'week') return j.weekday === slot.getUTCDay()
    if (j.every === 'month') return j.day === slot.getUTCDate()
    return true
  })
}
