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

describe('runCardsSync — delivery card names the merged epic PR (#4501)', () => {
  const LABELED_AT = '2026-11-20T10:00:00Z'
  const epicPrHit = (number: number, title: string, mergedAt: string | null) => ({
    number, title, body: '', html_url: `https://github.com/o/r/pull/${number}`, labels: [], pull_request: { merged_at: mergedAt }
  })
  beforeEach(() => {
    gh.labelled['status:to-test'] = [{
      number: 70, title: 'Epic 70', body: '## 🧪 How to test\n1. Open /x', html_url: 'https://github.com/o/r/issues/70',
      labels: [{ name: 'epic' }, { name: 'status:to-test' }], updated_at: OLD
    }]
    gh.events[70] = [{ event: 'labeled', label: { name: 'status:to-test' }, created_at: LABELED_AT }]
    gh.prFiles[501] = [{ filename: 'pocs/a.ts', additions: 10, deletions: 2 }, { filename: 'pocs/b.ts', additions: 3, deletions: 1 }]
    gh.prFiles[502] = [{ filename: 'pocs/z.ts', additions: 999, deletions: 999 }]
    gh.prFiles[503] = [{ filename: 'pocs/y.ts', additions: 7, deletions: 7 }]
    gh.prFiles[504] = [{ filename: 'pocs/new.ts', additions: 4, deletions: 0 }]
  })
  const stored = (changes: unknown) => ({
    id: 'd1', kind: 'delivery', sourceType: 'issue', sourceNumber: 70, sourceCommentId: LABELED_AT, title: 'Epic 70',
    ask: 'Try it, then reply ok or not ok.', link: 'https://github.com/o/r/issues/70', state: 'waiting', askedAt: LABELED_AT,
    payload: { steps: ['Open /x'], to: '/x', changes }
  })
  const deliveryCard = () => created.find(c => c.kind === 'delivery')

  // covers: T2
  it('keeps only merged "Epic #70:" PRs — a title that merely contains 70 and an unmerged one are ignored', async () => {
    gh.epicPrHits = [
      epicPrHit(501, 'Epic #70: the thing', '2026-11-19T10:00:00Z'),
      epicPrHit(502, 'Epic #2889: … 70 workflows …', '2026-11-21T10:00:00Z'),
      epicPrHit(503, 'Epic #70: the thing (again)', null)
    ]
    await sync()
    expect(deliveryCard()?.payload.changes).toEqual({ files: 2, added: 13, removed: 3, top: ['pocs/a.ts', 'pocs/b.ts'], pr: 501, prCount: 1 })
  })

  // covers: T2
  it('two merged epic PRs → the newer merged_at one, prCount 2', async () => {
    gh.epicPrHits = [
      epicPrHit(501, 'Epic #70: first', '2026-11-19T10:00:00Z'),
      epicPrHit(504, 'Epic #70: second', '2026-11-22T10:00:00Z')
    ]
    await sync()
    expect(deliveryCard()?.payload.changes).toMatchObject({ files: 1, added: 4, removed: 0, pr: 504, prCount: 2 })
  })

  // covers: T2
  it('the epic-PR search fails → the stored card is left unchanged and #70 is skipped', async () => {
    gh.failEpicSearch = true
    gh.existingCards = [stored({ files: 9, added: 9, removed: 9, top: [], pr: 1, prCount: 1 })]
    const out = await sync()
    expect(out.skipped).toContain(70)
    expect(updateInboxCard.mock.calls.some((c: any[]) => c[0] === 'd1')).toBe(false)
  })

  // covers: T2
  it('the search works → the stored card with different changes is updated', async () => {
    gh.epicPrHits = [epicPrHit(501, 'Epic #70: the thing', '2026-11-19T10:00:00Z')]
    gh.existingCards = [stored({ files: 9, added: 9, removed: 9, top: [], pr: 1, prCount: 1 })]
    await sync()
    const call = (updateInboxCard.mock.calls as any[][]).find(c => c[0] === 'd1')
    expect(call).toBeDefined()
    expect(call!.find(a => a && typeof a === 'object' && 'payload' in a)?.payload.changes).toMatchObject({ pr: 501, prCount: 1 })
  })
})

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
