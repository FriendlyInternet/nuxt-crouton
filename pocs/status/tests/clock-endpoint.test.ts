import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createStorage } from 'unstorage'
import memory from 'unstorage/drivers/memory'
import { CLOCK_JOBS } from '../server/utils/clock-jobs'
import { CARDS_SYNC_SINCE } from '../server/utils/clock-status-core'

// Drives the REAL handler (server/api/status/clock.get.ts) with Nitro globals stubbed and ghFetch
// answering from a fake GitHub: each workflow's name, and its clock runs. (ghFetch itself is the
// shared reader every /api/status route uses; its real GET is covered in github-core.test.ts.)

let fail: Record<string, string>
let paths: string[]
/** #4269: this workflow's clock run (id 77) ended cancelled; its /jobs count and the later runs it can read. */
let cancelWf: string | null
let jobsCount: number
let laterError: string | null
const CANCELLED_ID = 77
/** KV the endpoint reads the clock sync's record from (`clock:cards-sync:last`, #4234). */
let kv: ReturnType<typeof createStorage>

const NOW = '2026-11-19T10:45:00Z' // automerge (:10 slot) ran at 10:13; pipeline-metrics (:20 slot) ran at 10:22

function fakeGh(_event: unknown, path: string) {
  paths.push(path)
  // /actions/runs/<id>/jobs carries no workflow in its path, so match it before the /runs branch.
  const jobsOf = path.match(/actions\/runs\/(\d+)\/jobs/)?.[1]
  if (jobsOf) return Promise.resolve({ data: { total_count: Number(jobsOf) === CANCELLED_ID ? jobsCount : 1 }, error: null })
  const wf = path.match(/actions\/workflows\/([^/?]+)/)?.[1] as string
  if (path.includes('created=')) {
    if (laterError) return Promise.resolve({ data: null, error: laterError })
    return Promise.resolve({
      data: {
        workflow_runs: [{
          id: 88, html_url: `https://gh/${wf}/88`, event: 'workflow_run', status: 'completed', conclusion: 'success',
          created_at: '2026-11-19T10:13:20Z', display_title: 'other', actor: { login: 'pmcp' }
        }]
      },
      error: null
    })
  }
  if (fail[wf]) return Promise.resolve({ data: null, error: fail[wf] })
  if (wf === cancelWf && path.includes('/runs')) {
    return Promise.resolve({
      data: {
        workflow_runs: [{
          id: CANCELLED_ID, html_url: `https://gh/${wf}/77`, event: 'workflow_dispatch', status: 'completed', conclusion: 'cancelled',
          created_at: '2026-11-19T10:13:00Z', display_title: `name of ${wf}`, actor: { login: 'nuxt-harness[bot]' }
        }]
      },
      error: null
    })
  }
  if (!path.includes('/runs')) return Promise.resolve({ data: { name: `name of ${wf}` }, error: null })
  if (wf === 'e2e.yml') return Promise.resolve({ data: { workflow_runs: [] }, error: null }) // never run by the clock yet
  const created = wf === 'automerge-epic-subpr.yml' ? '2026-11-19T10:13:00Z' : '2026-11-19T10:22:00Z'
  return Promise.resolve({
    data: {
      workflow_runs: [{
        id: 1, html_url: `https://gh/${wf}`, event: 'workflow_dispatch', status: 'completed', conclusion: 'success',
        created_at: created, display_title: `name of ${wf}`, actor: { login: 'nuxt-harness[bot]' }
      }]
    },
    error: null
  })
}

async function handler() {
  vi.resetModules()
  vi.stubGlobal('defineEventHandler', (h: unknown) => h)
  vi.stubGlobal('requireStatusOwner', async () => {})
  vi.stubGlobal('ghFetch', fakeGh)
  vi.stubGlobal('useStorage', () => kv)
  return (await import('../server/api/status/clock.get')).default as unknown as (e: unknown) => Promise<any>
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(NOW))
  fail = {}
  paths = []
  cancelWf = null
  jobsCount = 0
  laterError = null
  kv = createStorage({ driver: memory() })
})

/** A Worker with the clock on (shared staging). */
const clockOn = { context: { cloudflare: { env: { CLOCK_ENABLED: '1' } } } }
const syncRow = (res: any) => res.data[13]
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('GET /api/status/clock', () => {
  // covers: T3
  it('one row per clock job, read from the clock runs list', async () => {
    const res = await (await handler())({})
    expect(res.data).toHaveLength(14)
    expect(res.data.slice(0, 13).map((r: any) => r.workflow)).toEqual(CLOCK_JOBS.map(j => j.workflow))
    expect(res.error).toBeNull()
    const by = (wf: string) => res.data.find((r: any) => r.workflow === wf)
    expect(by('automerge-epic-subpr.yml').state).toBe('ok')
    expect(by('pipeline-metrics.yml').state).toBe('ok')
    // e2e was last due 04:00, before it moved to the clock at 07:45, and has no clock run — not a miss.
    expect(by('e2e.yml').state).toBe('before-clock')
    expect(by('e2e.yml').about).toBe(CLOCK_JOBS.find(j => j.workflow === 'e2e.yml')?.about)
    expect(paths).toContain('/repos/FriendlyInternet/nuxt-crouton/actions/workflows/e2e.yml/runs?event=workflow_dispatch&actor=nuxt-harness%5Bbot%5D&per_page=10')
  })

  // covers: T3
  it('one workflow failing to read → that row unknown with the reason, the others fine', async () => {
    fail['automerge-epic-subpr.yml'] = 'GitHub 500 Internal Server Error'
    const res = await (await handler())({})
    expect(res.data).toHaveLength(14)
    const bad = res.data.find((r: any) => r.workflow === 'automerge-epic-subpr.yml')
    expect(bad.state).toBe('unknown')
    expect(bad.error).toBe('GitHub 500 Internal Server Error')
    expect(res.data.find((r: any) => r.workflow === 'pipeline-metrics.yml').state).toBe('ok')
    expect(res.data.filter((r: any) => r.state === 'unknown')).toHaveLength(1)
  })

  // covers: T3
  it('a 403 on every read → every row unknown, saying the token needs Actions: read', async () => {
    for (const j of CLOCK_JOBS) fail[j.workflow] = 'GitHub 403 Forbidden'
    const res = await (await handler())({})
    expect(res.data.slice(0, 13).every((r: any) => r.state === 'unknown' && r.error === 'the status token needs Actions: read')).toBe(true)
    expect(res.error).toBe('the status token needs Actions: read')
  })
})

describe('GET /api/status/clock — a cancelled clock run replaced by a newer run (#4269)', () => {
  const AM = 'automerge-epic-subpr.yml'
  const jobsReads = () => paths.filter(p => p.includes('/jobs'))
  const createdReads = () => paths.filter(p => p.includes('created='))

  // covers: T6
  it('7. never started a job + a later success → that row ok, one /jobs read and one created= read, for it only', async () => {
    cancelWf = AM
    const res = await (await handler())({})
    const row = res.data.find((r: any) => r.workflow === AM)
    expect(row.state).toBe('ok')
    expect(row.lastRun.id).toBe(88)
    expect(jobsReads()).toEqual([`/repos/FriendlyInternet/nuxt-crouton/actions/runs/${CANCELLED_ID}/jobs?per_page=1`])
    expect(createdReads()).toEqual([
      `/repos/FriendlyInternet/nuxt-crouton/actions/workflows/${AM}/runs?per_page=20&created=2026-11-19T10:13:00Z..2026-11-19T10:33:00.000Z`
    ])
    expect(res.error).toBeNull()
  })

  // covers: T6
  it('8. never started a job, the created= read errors → that row failed, no tab-wide error', async () => {
    cancelWf = AM
    laterError = 'GitHub 500 Internal Server Error'
    const res = await (await handler())({})
    const row = res.data.find((r: any) => r.workflow === AM)
    expect(row.state).toBe('failed')
    expect(row.lastRun.id).toBe(CANCELLED_ID)
    expect(res.error).toBeNull()
  })

  // covers: T6
  it('9. it started a job (total_count 1) → that row failed, no created= read', async () => {
    cancelWf = AM
    jobsCount = 1
    const res = await (await handler())({})
    expect(res.data.find((r: any) => r.workflow === AM).state).toBe('failed')
    expect(jobsReads()).toHaveLength(1)
    expect(createdReads()).toHaveLength(0)
  })
})

describe('GET /api/status/clock — the inbox stuck check row (#4234)', () => {
  // covers: T4
  it('a fresh ok record (10:31, NOW 10:45) → ok, last = the record\'s time, every 30 min, no link', async () => {
    const at = '2026-11-19T10:31:00Z'
    await kv.setItem('clock:cards-sync:last', { at, ok: true, counts: { created: 1, updated: 0, stale: 0, answered: 0, stuck: { quiet: 0, draft: 0, epicSync: 0 } }, readErrors: null })
    const res = await (await handler())(clockOn)
    expect(res.data).toHaveLength(14)
    expect(res.data.slice(0, 13).map((r: any) => r.workflow)).toEqual(CLOCK_JOBS.map(j => j.workflow))
    expect(syncRow(res)).toEqual({
      workflow: 'inbox stuck check',
      schedule: 'every 30 min',
      about: 'Checks GitHub for stuck tickets, idle drafts and other things waiting on you, and updates the inbox — even when you haven\'t opened it.',
      lastDue: '2026-11-19T10:30:00.000Z',
      nextDue: '2026-11-19T11:00:00.000Z',
      lastRun: { createdAt: at },
      state: 'ok',
      error: null
    })
    expect(res.error).toBeNull()
  })

  // covers: T4
  it('a record with ok: false → failed, with its error as the row text', async () => {
    await kv.setItem('clock:cards-sync:last', { at: '2026-11-19T10:30:05Z', ok: false, error: 'owner or team not found (NUXT_STATUS_OWNER_EMAIL / test1)' })
    const row = syncRow(await (await handler())(clockOn))
    expect(row.state).toBe('failed')
    expect(row.error).toBe('owner or team not found (NUXT_STATUS_OWNER_EMAIL / test1)')
    expect(row.lastRun).toEqual({ createdAt: '2026-11-19T10:30:05Z' })
  })

  // covers: T4
  it('an ok record 50 min old → missed', async () => {
    await kv.setItem('clock:cards-sync:last', { at: '2026-11-19T09:55:00Z', ok: true, readErrors: null })
    expect(syncRow(await (await handler())(clockOn)).state).toBe('missed')
  })

  // covers: T4
  it('no record, before CARDS_SYNC_SINCE → before-clock', async () => {
    vi.setSystemTime(new Date(Date.parse(CARDS_SYNC_SINCE) - 3_600_000))
    expect(syncRow(await (await handler())(clockOn)).state).toBe('before-clock')
  })

  // covers: T4
  it('no record on a Worker without the clock (a preview) → before-clock, even long after since', async () => {
    vi.setSystemTime(new Date(Date.parse(CARDS_SYNC_SINCE) + 2 * 3_600_000))
    expect(syncRow(await (await handler())({})).state).toBe('before-clock')
  })

  // covers: T4
  it('no record, clock on, 2 h after CARDS_SYNC_SINCE → missed', async () => {
    vi.setSystemTime(new Date(Date.parse(CARDS_SYNC_SINCE) + 2 * 3_600_000))
    const row = syncRow(await (await handler())(clockOn))
    expect(row.state).toBe('missed')
    expect(row.lastRun).toBeNull()
  })

  // covers: T4
  it('an ok record with readErrors → the row\'s text, not the tab-wide error', async () => {
    await kv.setItem('clock:cards-sync:last', { at: '2026-11-19T10:31:00Z', ok: true, readErrors: 'GitHub 500' })
    const res = await (await handler())(clockOn)
    expect(syncRow(res).state).toBe('ok')
    expect(syncRow(res).error).toBe('GitHub 500')
    expect(res.error).toBeNull()
  })
})
