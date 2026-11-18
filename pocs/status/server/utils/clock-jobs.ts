// The status app's clock (#4133): which workflow is due in which 10-minute slot.
// Pure, no storage — a slot whose tick never arrives is skipped (no catch-up, by design).
// To add a job: add a row here, give the workflow `workflow_dispatch`, and remove its `schedule:`.

export interface ClockJob {
  workflow: string
  every: 'hour'
  minute: number
}

export const CLOCK_JOBS: ClockJob[] = [
  { workflow: 'automerge-epic-subpr.yml', every: 'hour', minute: 17 },
  { workflow: 'pipeline-metrics.yml', every: 'hour', minute: 23 },
  { workflow: 'handoff-sweep.yml', every: 'hour', minute: 41 }
]

/** Jobs whose minute falls in the 10-minute slot that contains `slot` (UTC): [slotStart, slotStart + 10). */
export function dueJobs(slot: Date, jobs: ClockJob[] = CLOCK_JOBS): ClockJob[] {
  const start = Math.floor(slot.getUTCMinutes() / 10) * 10
  return jobs.filter(j => j.minute >= start && j.minute < start + 10)
}
