import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CLOCK_JOBS } from '../server/utils/clock-jobs'

// Drives the REAL handler (server/api/status/clock.get.ts) with Nitro globals stubbed and ghFetch
// answering from a fake GitHub: each workflow's name, and its clock runs. (ghFetch itself is the
// shared reader every /api/status route uses; its real GET is covered in github-core.test.ts.)

let fail: Record<string, string>
let paths: string[]

const NOW = '2026-11-19T10:45:00Z' // automerge (:10 slot) ran at 10:13; pipeline-metrics (:20 slot) ran at 10:22

function fakeGh(_event: unknown, path: string) {
  paths.push(path)
  const wf = path.match(/actions\/workflows\/([^/?]+)/)?.[1] as string
  if (fail[wf]) return Promise.resolve({ data: null, error: fail[wf] })
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
  return (await import('../server/api/status/clock.get')).default as unknown as (e: unknown) => Promise<any>
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(NOW))
  fail = {}
  paths = []
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('GET /api/status/clock', () => {
  // covers: T3
  it('one row per clock job, read from the clock runs list', async () => {
    const res = await (await handler())({})
    expect(res.data).toHaveLength(13)
    expect(res.data.map((r: any) => r.workflow)).toEqual(CLOCK_JOBS.map(j => j.workflow))
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
    expect(res.data).toHaveLength(13)
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
    expect(res.data.every((r: any) => r.state === 'unknown' && r.error === 'the status token needs Actions: read')).toBe(true)
    expect(res.error).toBe('the status token needs Actions: read')
  })
})
