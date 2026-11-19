import { describe, expect, it } from 'vitest'
import { CLOCK_JOBS, dueJobs, type ClockJob } from '../server/utils/clock-jobs'
import { jobStatus, lastDue, nextDue, readError, scheduleWords, type GhRun } from '../server/utils/clock-status-core'

const job = (wf: string) => CLOCK_JOBS.find(j => j.workflow === wf) as ClockJob
const HOURLY = job('automerge-epic-subpr.yml') // :17 → slot :10
const DAILY = job('quality-digest.yml') // 06:30
const WEEKLY = job('weekly.yml') // Mon 06:30
const MONTHLY = job('skills-digest.yml') // 1st 05:00
const at = (iso: string) => new Date(iso)
const iso = (d: Date | null) => d?.toISOString()

describe('lastDue / nextDue', () => {
  // covers: T1
  it('hourly (:17) job: the :10 slot of this hour / the next hour', () => {
    expect(iso(lastDue(HOURLY, at('2026-11-19T10:25:00Z')))).toBe('2026-11-19T10:10:00.000Z')
    expect(iso(nextDue(HOURLY, at('2026-11-19T10:25:00Z')))).toBe('2026-11-19T11:10:00.000Z')
    expect(iso(lastDue(HOURLY, at('2026-11-19T10:12:00Z')))).toBe('2026-11-19T10:10:00.000Z') // inside the slot
    expect(iso(lastDue(HOURLY, at('2026-11-19T10:05:00Z')))).toBe('2026-11-19T09:10:00.000Z')
    expect(iso(nextDue(HOURLY, at('2026-11-19T10:05:00Z')))).toBe('2026-11-19T10:10:00.000Z')
  })

  // covers: T1
  it('daily (06:30) job', () => {
    expect(iso(lastDue(DAILY, at('2026-11-19T07:00:00Z')))).toBe('2026-11-19T06:30:00.000Z')
    expect(iso(nextDue(DAILY, at('2026-11-19T07:00:00Z')))).toBe('2026-11-20T06:30:00.000Z')
    expect(iso(lastDue(DAILY, at('2026-11-19T06:05:00Z')))).toBe('2026-11-18T06:30:00.000Z')
    expect(iso(nextDue(DAILY, at('2026-11-19T06:05:00Z')))).toBe('2026-11-19T06:30:00.000Z')
  })

  // covers: T1
  it('weekly (Mon 06:30) job', () => {
    // 2026-11-19 is a Thursday; Mondays are the 16th and 23rd.
    expect(iso(lastDue(WEEKLY, at('2026-11-19T12:00:00Z')))).toBe('2026-11-16T06:30:00.000Z')
    expect(iso(nextDue(WEEKLY, at('2026-11-19T12:00:00Z')))).toBe('2026-11-23T06:30:00.000Z')
    expect(iso(lastDue(WEEKLY, at('2026-11-16T06:35:00Z')))).toBe('2026-11-16T06:30:00.000Z')
  })

  // covers: T1
  it('monthly (1st 05:00) job looks back across a whole month', () => {
    expect(iso(lastDue(MONTHLY, at('2026-11-30T23:55:00Z')))).toBe('2026-11-01T05:00:00.000Z')
    expect(iso(nextDue(MONTHLY, at('2026-11-30T23:55:00Z')))).toBe('2026-12-01T05:00:00.000Z')
    expect(iso(lastDue(MONTHLY, at('2026-11-01T04:55:00Z')))).toBe('2026-10-01T05:00:00.000Z')
  })

  // covers: T1
  it('every job: lastDue and nextDue are slots dueJobs itself picks', () => {
    const now = at('2026-11-19T12:34:00Z')
    for (const j of CLOCK_JOBS) {
      const last = lastDue(j, now) as Date
      const next = nextDue(j, now) as Date
      expect(dueJobs(last)).toContain(j)
      expect(dueJobs(next)).toContain(j)
      expect(last.getTime()).toBeLessThanOrEqual(now.getTime())
      expect(next.getTime()).toBeGreaterThan(now.getTime())
    }
  })
})

describe('scheduleWords', () => {
  it('says the timing in plain words', () => {
    expect(scheduleWords(HOURLY)).toBe('every hour, :10–:20')
    expect(scheduleWords(DAILY)).toBe('daily 06:30 UTC')
    expect(scheduleWords(WEEKLY)).toBe('Mondays 06:30 UTC')
    expect(scheduleWords(MONTHLY)).toBe('1st of the month 05:00 UTC')
  })
})

describe('jobStatus', () => {
  const NAME = 'Automerge epic sub-PRs'
  let id = 0
  const run = (over: Partial<GhRun> & { created_at: string }): GhRun => ({
    id: ++id,
    html_url: `https://github.com/r/actions/runs/${id}`,
    event: 'workflow_dispatch',
    status: 'completed',
    conclusion: 'success',
    display_title: NAME,
    actor: { login: 'nuxt-harness[bot]' },
    ...over
  })
  const status = (now: string, runs: GhRun[]) => jobStatus(HOURLY, at(now), runs, NAME)

  // covers: T2
  it('clock run 3 min after the slot, success → ok (and it is the lastRun)', () => {
    const r = run({ created_at: '2026-11-19T10:13:00Z' })
    const s = status('2026-11-19T10:45:00Z', [r])
    expect(s.state).toBe('ok')
    expect(s.lastDue).toBe('2026-11-19T10:10:00.000Z')
    expect(s.lastRun?.url).toBe(r.html_url)
  })

  // covers: T2
  it('skipped counts as ok', () => {
    expect(status('2026-11-19T10:45:00Z', [run({ created_at: '2026-11-19T10:13:00Z', conclusion: 'skipped' })]).state).toBe('ok')
  })

  // covers: T2
  it('in progress → running', () => {
    expect(status('2026-11-19T10:15:00Z', [run({ created_at: '2026-11-19T10:13:00Z', status: 'in_progress', conclusion: null })]).state).toBe('running')
  })

  // covers: T2
  it('failure / cancelled / timed_out → failed', () => {
    for (const conclusion of ['failure', 'cancelled', 'timed_out']) {
      expect(status('2026-11-19T10:45:00Z', [run({ created_at: '2026-11-19T10:13:00Z', conclusion })]).state).toBe('failed')
    }
  })

  // covers: T2
  it('only a run started by someone else, or none, slot 30 min ago → missed', () => {
    expect(status('2026-11-19T10:40:00Z', [run({ created_at: '2026-11-19T10:13:00Z', actor: { login: 'pmcp' } })]).state).toBe('missed')
    expect(status('2026-11-19T10:40:00Z', []).state).toBe('missed')
  })

  // covers: T2
  it('a bot run titled "automerge #123" inside the slot → missed', () => {
    expect(status('2026-11-19T10:40:00Z', [run({ created_at: '2026-11-19T10:13:00Z', display_title: 'automerge #123' })]).state).toBe('missed')
  })

  // covers: T2
  it('five newer hand runs by the owner do not hide a clock run in the slot', () => {
    const hand = [1, 2, 3, 4, 5].map(i => run({ created_at: `2026-11-19T10:3${i}:00Z`, actor: { login: 'pmcp' }, conclusion: 'failure' }))
    const s = status('2026-11-19T10:40:00Z', [...hand, run({ created_at: '2026-11-19T10:12:00Z' })])
    expect(s.state).toBe('ok')
  })

  // covers: T2
  it('slot 5 min ago and no run → due', () => {
    expect(status('2026-11-19T10:15:00Z', []).state).toBe('due')
  })

  // covers: T2
  it('a run from an older slot does not count for the latest one', () => {
    const old = run({ created_at: '2026-11-19T09:12:00Z' })
    const s = status('2026-11-19T10:40:00Z', [old])
    expect(s.state).toBe('missed')
    expect(s.lastRun?.id).toBe(old.id) // still shown as the last run
  })

  // covers: T2
  it('a run created more than 20 min after the slot start is not the slot run', () => {
    expect(status('2026-11-19T10:50:00Z', [run({ created_at: '2026-11-19T10:31:00Z' })]).state).toBe('missed')
  })
})

describe('readError', () => {
  it('a 403 means the token lacks Actions: read', () => {
    expect(readError('GitHub 403 Forbidden')).toBe('the status token needs Actions: read')
    expect(readError('GitHub 500 Internal Server Error')).toBe('GitHub 500 Internal Server Error')
  })
})

