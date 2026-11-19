// The status app's clock (#4133): which workflow is due in which 10-minute slot.
// Pure, no storage — a slot whose tick never arrives is skipped (no catch-up, by design).
// To add a job: add a row here, give the workflow `workflow_dispatch` with a boolean `clock` input,
// make any manual-only branch check `!inputs.clock`, and remove its `schedule:`. The row needs an
// `about` line (what the job does, in plain words — shown when its Clock-tab row is tapped) and
// `since` set to when it moves to the clock (ISO, UTC), so the Clock tab doesn't call older slots "missed".
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
  /** When the job moved to the clock (ISO, UTC). A due slot before this isn't "missed". */
  since: string
  /** What the job does, in plain words — shown when its Clock-tab row is tapped. */
  about: string
}

/** When each batch moved to the clock: step 1 (PR #4135) and step 2 (PR #4176). */
const STEP1 = '2026-11-18T18:15:00Z'
const STEP2 = '2026-11-19T07:45:00Z'

export const CLOCK_JOBS: ClockJob[] = [
  { workflow: 'automerge-epic-subpr.yml', every: 'hour', minute: 17, since: STEP1, about: 'Merges finished sub-PRs into their epic\'s branch once their checks pass. PRs waiting for your look are left alone.' },
  { workflow: 'pipeline-metrics.yml', every: 'hour', minute: 23, since: STEP1, about: 'Copies the pipeline\'s run history into the metrics branch and updates the totals the reviews read.' },
  { workflow: 'handoff-sweep.yml', every: 'hour', minute: 41, since: STEP1, about: 'Retries pipeline hand-offs that GitHub refused (limit or server error), so a ticket doesn\'t stay stuck. Red if one still waits after 24 h.' },
  { workflow: 'e2e.yml', every: 'day', hour: 4, minute: 0, since: STEP2, about: 'Boots each test app and checks that sign-in, create/edit/delete and the package screens still work — the full nightly run behind the per-PR checks.' },
  { workflow: 'epic-digest.yml', every: 'day', hour: 5, minute: 0, since: STEP2, about: 'Emails the daily "where are we" roundup of the epics, on the days set in the digest settings.' },
  { workflow: 'label-ready-epics.yml', every: 'day', hour: 5, minute: 0, since: STEP2, about: 'Marks epics that are done but still open as "ready to close" or "needs postmortem", so the digests can list them.' },
  { workflow: 'skills-digest.yml', every: 'month', day: 1, hour: 5, minute: 0, since: STEP2, about: 'Emails the monthly list of skills and what changed since the last one.' },
  { workflow: 'housekeeping.yml', every: 'day', hour: 6, minute: 0, since: STEP2, about: 'Emails the weekly drift report: stale branches, stuck tickets, epics ready to close. Report only, changes nothing.' },
  { workflow: 'sync-changelogs.yml', every: 'day', hour: 6, minute: 0, since: STEP2, about: 'Pulls the latest package releases into the docs site\'s changelog, with a small data PR if anything changed.' },
  { workflow: 'quality-digest.yml', every: 'day', hour: 6, minute: 30, since: STEP2, about: 'Collects what the pipeline merged that week into a report. Wakes daily, runs on the set day.' },
  { workflow: 'weekly.yml', every: 'week', weekday: 1, hour: 6, minute: 30, since: STEP2, about: 'Monday chores in order: usage and findings roll-ups, the advisor\'s recommendations, clearing merged branches.' },
  { workflow: 'pipeline-review.yml', every: 'day', hour: 6, minute: 45, since: STEP2, about: 'Every 10 closed epics, opens a read-only review issue (top causes, code quality, proposals). Wakes daily to count.' },
  { workflow: 'pi-key-canary.yml', every: 'day', hour: 7, minute: 0, since: STEP2, about: 'Calls the agent\'s provider key once a day and warns if it\'s empty or broken, before builds start failing.' }
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
