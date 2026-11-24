import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OLD, boardMock, boardQueries, fetchSpy, gh, resetGh } from './helpers/gh-routes'

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
// The Pipeline board's rows (#4349): an in-memory table (no D1 in vitest).
vi.mock('../layers/pipeline/collections/items/server/database/queries', () => boardMock())

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

// T5 (#4349): the same sync writes the Pipeline board from the lists it already read.
const issue = (n: number, labels: string[]) => ({ number: n, title: `Issue ${n}`, body: '', html_url: `https://github.com/o/r/issues/${n}`, labels: labels.map(name => ({ name })), updated_at: new Date().toISOString() }) // recent: no "quiet" stuck card
const HOUR = 3_600_000

describe('runCardsSync writes the Pipeline board (#4349)', () => {
  // covers: T5
  it('makes exactly as many GitHub reads as before the board (20 for the default fixture)', async () => {
    await sync()
    expect(fetchSpy).toHaveBeenCalledTimes(20) // recorded on main a7ac050 before this change
  })

  // covers: T5
  it('upserts one row per pipeline issue, PRs folded into the issue they close, still with 20 reads', async () => {
    gh.labelled['work-this'] = [issue(11, ['work-this', 'poc:status']), issue(50, ['work-this'])]
    const out = await sync()
    expect(out.error).toBeUndefined()
    expect(fetchSpy).toHaveBeenCalledTimes(20)
    const byNumber = Object.fromEntries(gh.board.map(r => [r.number, r]))
    expect(Object.keys(byNumber).sort()).toEqual(['11', '50']) // #13 (PR 12's issue) has no pipeline label and no row
    expect(byNumber[11]).toMatchObject({ teamId: 'team1', owner: 'u1', title: 'Issue 11', labels: 'work-this,poc:status', prNumber: 10, prHeadSha: 'sha10', prBase: 'main', stage: 'you' })
    expect(byNumber[50]).toMatchObject({ stage: 'working' })
    expect(byNumber[50].prNumber ?? null).toBeNull()
    expect(boardQueries.deletePipelineItem).not.toHaveBeenCalled()
  })

  // covers: T5
  it('all lists read: a row missing from them gets closedAt, a row whose PR closed loses its PR fields, a row closed > 24 h ago is deleted', async () => {
    gh.labelled['work-this'] = [issue(50, ['work-this'])]
    const since = new Date(Date.now() - 5 * HOUR)
    gh.board = [
      { id: 'r50', number: 50, labels: 'work-this', prNumber: 77, prHeadSha: 'x', prBase: 'main', prLabels: 'a', verdict: 'go', verdictSha: 'x', stage: 'review', stageSince: since, order: since.getTime() },
      { id: 'r99', number: 99, labels: 'work-this', stage: 'working', stageSince: since, order: since.getTime() },
      { id: 'r98', number: 98, labels: 'work-this', stage: 'done', closedAt: new Date(Date.now() - 30 * HOUR) }
    ]
    const out = await sync()
    expect(out.error).toBeUndefined()
    const r50 = gh.board.find(r => r.id === 'r50')
    expect(r50).toMatchObject({ prNumber: null, prHeadSha: null, prBase: null, prLabels: null, verdict: null, verdictSha: null, stage: 'working' })
    const r99 = gh.board.find(r => r.id === 'r99')
    expect(r99.closedAt).toBeInstanceOf(Date)
    expect(r99.stage).toBe('done')
    expect(gh.board.find(r => r.id === 'r98')).toBeUndefined()
  })

  // covers: T5
  it('one list failed: nothing is closed, cleared or deleted', async () => {
    gh.labelled['work-this'] = [issue(50, ['work-this'])]
    gh.failList = 'delegate'
    gh.board = [
      { id: 'r50', number: 50, labels: 'work-this', prNumber: 77, prHeadSha: 'x', stage: 'review', stageSince: new Date(), order: 1 },
      { id: 'r99', number: 99, labels: 'work-this', stage: 'working', stageSince: new Date(), order: 1 },
      { id: 'r98', number: 98, labels: 'work-this', stage: 'done', closedAt: new Date(Date.now() - 30 * HOUR) }
    ]
    const out = await sync()
    expect(out.error).toContain('GitHub 500')
    expect(gh.board.find(r => r.id === 'r50')).toMatchObject({ prNumber: 77, prHeadSha: 'x' })
    expect(gh.board.find(r => r.id === 'r99')!.closedAt).toBeUndefined()
    expect(gh.board.find(r => r.id === 'r98')).toBeDefined()
    expect(boardQueries.deletePipelineItem).not.toHaveBeenCalled()
  })

  // covers: T5
  it('a failed board write is logged in error, and the card counts stay as they were', async () => {
    gh.labelled['work-this'] = [issue(50, ['work-this'])]
    boardQueries.createPipelineItem.mockRejectedValueOnce(new Error('D1 down'))
    const out = await sync()
    expect(out.created).toBe(2)
    expect(out.error).toContain('1 board write(s) failed: D1 down')
  })
})
