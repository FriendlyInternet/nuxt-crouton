import { beforeEach, describe, expect, it, vi } from 'vitest'

// Drives the REAL handler (server/api/status/apps.get.ts). Stubbed: the owner check + GitHub reader,
// the live-apps readers (GitHub), the card queries (generated CRUD; no D1 in vitest) and the team
// lookup — the same seams tests/cards-sync-endpoint.test.ts stubs.

const ghFetch = vi.fn()
vi.mock('../server/utils/github', () => ({
  requireStatusOwner: vi.fn(async () => {}),
  ghFetch: (...a: unknown[]) => ghFetch(...a)
}))
const listLiveApps = vi.fn(async () => ({
  data: [
    { app: 'velo', stagingUrl: 'https://velo.staging', hasSignIn: true },
    { app: 'kassa', stagingUrl: null, hasSignIn: false }
  ],
  error: null
}))
const listPreviews = vi.fn(async () => ({
  data: [
    { app: 'velo', pr: 77, title: 'Asks', updatedAt: '2026-11-15T09:00:00Z', url: 'https://velo-pr77' },
    { app: 'kassa', pr: 78, title: 'Does not ask', updatedAt: '2026-11-15T09:00:00Z', url: 'https://kassa-pr78' }
  ],
  error: null
}))
vi.mock('../server/utils/live-apps', () => ({
  listLiveApps: (...a: unknown[]) => (listLiveApps as any)(...a),
  listPreviews: (...a: unknown[]) => (listPreviews as any)(...a)
}))
const getAllInboxCards = vi.fn(async (..._a: unknown[]): Promise<unknown[]> => [
  { kind: 'review', state: 'waiting', sourceType: 'pr', sourceNumber: 77, payload: {} },
  { kind: 'issue', state: 'waiting', sourceType: 'pr', sourceNumber: 78, payload: { stuck: 'draft' } }
])
vi.mock('../layers/inbox/collections/cards/server/database/queries', () => ({
  getAllInboxCards: (...a: unknown[]) => (getAllInboxCards as any)(...a)
}))
vi.mock('@fyit/crouton-auth/server/utils/team', () => ({
  resolveTeamAndCheckMembership: vi.fn(async () => ({ team: { id: 'team1' }, user: { id: 'u1' }, membership: { role: 'owner' } }))
}))

async function call() {
  vi.resetModules()
  vi.stubGlobal('defineEventHandler', (h: unknown) => h)
  const handler = (await import('../server/api/status/apps.get')).default as unknown as (e: unknown) => Promise<any>
  return handler({ headers: new Headers(), context: {} })
}

const previewsOf = (body: any) => body.data.flatMap((a: any) => a.previews)

beforeEach(() => {
  ghFetch.mockClear()
  listLiveApps.mockClear()
  listPreviews.mockClear()
  getAllInboxCards.mockClear()
})

describe('GET /api/status/apps — asksOwner (#3045)', () => {
  // covers: T2 (#3045)
  it('marks each preview from the waiting review cards, with no new GitHub call', async () => {
    const body = await call()
    const byPr = Object.fromEntries(previewsOf(body).map((p: any) => [p.pr, p.asksOwner]))
    expect(byPr).toEqual({ 77: true, 78: false })
    expect(getAllInboxCards).toHaveBeenCalledWith('team1')
    expect(ghFetch).not.toHaveBeenCalled()
    expect(listLiveApps).toHaveBeenCalledTimes(1)
    expect(listPreviews).toHaveBeenCalledTimes(1)
    expect(body.error).toBeNull()
  })

  // covers: T3 (#3045)
  it('keeps the buttons on every preview and reports the error when the cards cannot be read', async () => {
    getAllInboxCards.mockRejectedValueOnce(new Error('D1 down'))
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const body = await call()
    spy.mockRestore()
    expect(previewsOf(body).map((p: any) => p.asksOwner)).toEqual([true, true])
    expect(body.error).toContain('Could not read the inbox')
  })
})
