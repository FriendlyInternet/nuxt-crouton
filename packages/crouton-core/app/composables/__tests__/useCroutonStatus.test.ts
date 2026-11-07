import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ref, computed } from 'vue'
import * as feed from '../../utils/status-feed'

const row = (id: string, ts: number, userId: string) => ({ id, timestamp: ts, operation: 'update', collectionName: 'posts', userId, itemId: id, userName: 'Bob' })
const ownRows = Array.from({ length: 3 }, (_, i) => row(`own${i}`, 1000 + i, 'me'))
const teamRows = Array.from({ length: 20 }, (_, i) => row(`team${i}`, 5000 + i, 'bob'))

let apps: string[]
let states: Map<string, any>
let fetchMock: ReturnType<typeof vi.fn>

async function load() {
  vi.resetModules()
  states = new Map()
  vi.stubGlobal('useState', (key: string, init?: () => any) => {
    if (!states.has(key)) states.set(key, ref(init ? init() : undefined))
    return states.get(key)
  })
  states.set('crouton-auth-user', ref({ id: 'me', name: 'Me Me' }))
  vi.stubGlobal('computed', computed)
  for (const [k, v] of Object.entries(feed)) vi.stubGlobal(k, v)
  vi.stubGlobal('useT', () => ({ t: (k: string) => k }))
  vi.stubGlobal('useCroutonApps', () => ({ hasApp: (a: string) => apps.includes(a) }))
  vi.stubGlobal('useTeamContext', () => ({ getTeamId: () => 'team1' }))
  vi.stubGlobal('useNuxtApp', () => ({ hook: () => () => {} }))
  vi.stubGlobal('getCurrentInstance', () => null)
  vi.stubGlobal('$fetch', fetchMock)
  const mod = await import('../useCroutonStatus')
  return mod.useCroutonStatus()
}

beforeEach(() => {
  apps = ['events', 'collab']
  fetchMock = vi.fn()
  vi.useFakeTimers()
})
afterEach(() => vi.useRealTimers())

describe('useCroutonStatus', () => {
  it('sends own and team requests when collab is on', async () => {
    fetchMock.mockResolvedValue([])
    const s = await load()
    await s.refreshTeamEvents(true)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const queries = fetchMock.mock.calls.map(c => c[1].query)
    expect(queries.find(q => q.userId === 'me')?.pageSize).toBe(3)
    expect(queries.find(q => q.userId === undefined)?.pageSize).toBe(20)
  })

  it('keeps own changes visible when the team is busy', async () => {
    fetchMock.mockImplementation(async (_u: string, o: any) => (o.query.userId ? ownRows : teamRows))
    const s = await load()
    await s.refreshTeamEvents(true)
    const ids = s.recent.value.map((m: any) => m.id)
    expect(ids).toEqual(expect.arrayContaining(['event-own2', 'event-own1', 'event-own0']))
    expect(s.recent.value).toHaveLength(5)
  })

  it('sends a single own-only request without collab', async () => {
    apps = ['events']
    fetchMock.mockResolvedValue([])
    const s = await load()
    await s.refreshTeamEvents(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0]![1].query.userId).toBe('me')
  })

  it('retries once when the teammate row was not stored yet', async () => {
    let round = 0
    fetchMock.mockImplementation(async (_u: string, o: any) => {
      if (o.query.userId) return []
      return round >= 2 ? [row('late', 9000, 'bob')] : []
    })
    const s = await load()
    await s.onRemoteChange()
    round = 2
    expect(fetchMock).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(2000)
    expect(fetchMock).toHaveBeenCalledTimes(4)
    expect(s.recent.value.map((m: any) => m.id)).toContain('event-late')
  })

  it('does not retry when the teammate row arrived', async () => {
    fetchMock.mockImplementation(async (_u: string, o: any) => (o.query.userId ? [] : [row('t1', 9000, 'bob')]))
    const s = await load()
    await s.onRemoteChange()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('retries only once', async () => {
    fetchMock.mockResolvedValue([])
    const s = await load()
    await s.onRemoteChange()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(fetchMock).toHaveBeenCalledTimes(4)
  })

  it('does not retry when the requests fail', async () => {
    fetchMock.mockRejectedValue(new Error('403'))
    const s = await load()
    await s.onRemoteChange()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('a burst of remote changes leaves one retry', async () => {
    fetchMock.mockResolvedValue([])
    const s = await load()
    await s.onRemoteChange()
    await s.onRemoteChange()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(fetchMock).toHaveBeenCalledTimes(6)
  })
})
