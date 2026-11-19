import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OLD, fetchSpy, gh, resetGh } from './helpers/gh-routes'

// T2 (#4234): runCardsSync — the sync with no request, as the clock calls it — reads GitHub with the
// token it is given and writes the same cards as POST /api/cards/sync. It drives the REAL GitHub
// reader (github.ts, gh-paged.ts, github-core.ts) against the shared fake GitHub
// (tests/helpers/gh-routes.ts); only global fetch and the generated card queries are stubbed (no D1
// in vitest), the queries by an in-memory card store.

/** The in-memory card store: cards written by this run. */
let created: any[]
const createInboxCard = vi.fn(async (c: any) => { created.push(c); return c })
const updateInboxCard = vi.fn(async () => ({}))
vi.mock('../layers/inbox/collections/cards/server/database/queries', () => ({
  getAllInboxCards: vi.fn(async () => gh.existingCards),
  createInboxCard: (...a: unknown[]) => (createInboxCard as any)(...a),
  updateInboxCard: (...a: unknown[]) => (updateInboxCard as any)(...a)
}))

async function runCardsSync() {
  vi.resetModules()
  vi.stubGlobal('defineCachedFunction', (fn: unknown) => fn)
  vi.stubGlobal('fetch', fetchSpy)
  return (await import('../server/utils/cards-sync-run')).runCardsSync
}
const sync = async () => (await runCardsSync())({ token: 't', teamId: 'team1', userId: 'u1' })

beforeEach(() => {
  resetGh()
  created = []
  createInboxCard.mockClear()
  updateInboxCard.mockClear()
})
afterEach(() => { vi.unstubAllGlobals() })

describe('runCardsSync (no request)', () => {
  // covers: T2
  it('creates one review card per sign-off PR, like the endpoint, reading GitHub with the token it was given', async () => {
    const out = await sync()
    expect(out).toEqual({ created: 2, updated: 0, stale: 0, answered: 0, stuck: { quiet: 0, draft: 0, epicSync: 0 } })
    expect(created.map(c => c.sourceNumber)).toEqual([10, 12])
    expect(created[0]).toMatchObject({ kind: 'review', sourceType: 'pr', teamId: 'team1', owner: 'u1', createdBy: 'u1', updatedBy: 'u1', state: 'waiting' })
    expect(fetchSpy).toHaveBeenCalled()
    for (const [, init] of fetchSpy.mock.calls) {
      expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer t')
    }
  })

  // covers: T2
  it('no token → every read fails, no card is written', async () => {
    const out = await (await runCardsSync())({ token: undefined, teamId: 'team1', userId: 'u1' })
    expect(out.error).toContain('GITHUB_TOKEN is not configured')
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(created).toEqual([])
  })

  // covers: T2
  it('reads open PRs past page 1 (100 drafts, then the sign-off PRs)', async () => {
    gh.pagedPulls = true
    const out = await sync()
    expect(out.stuck).toEqual({ quiet: 0, draft: 100, epicSync: 0 })
    expect(out.created).toBe(102)
  })

  // covers: T2
  it('one comments read returns 500 → error + skipped [12], only #10 written', async () => {
    gh.failComments = 12
    const out = await sync()
    expect(out.error).toContain('GitHub 500')
    expect(out.skipped).toEqual([12])
    expect(out.created).toBe(1)
    expect(created.map(c => c.sourceNumber)).toEqual([10])
    expect(updateInboxCard).not.toHaveBeenCalled()
  })

  // covers: T2
  it('a waiting card whose ask is gone goes stale', async () => {
    gh.existingCards = [{ id: 'c1', kind: 'issue', sourceType: 'issue', sourceNumber: 77, sourceCommentId: 'gone', title: 'x', ask: 'x', link: 'x', state: 'waiting', askedAt: OLD }]
    const out = await sync()
    expect(out.error).toBeUndefined()
    expect(out.stale).toBe(1)
    expect(updateInboxCard).toHaveBeenCalledWith('c1', 'team1', 'u1', { state: 'stale' }, { role: 'owner' })
  })
})
