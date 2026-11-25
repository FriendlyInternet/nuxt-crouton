import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createError } from 'h3'
import { createStorage } from 'unstorage'
import memory from 'unstorage/drivers/memory'
import { BOT, EPIC_BRANCH, MAIN_SHA, OLD, boardMock, fetchSpy, gh, resetGh } from './helpers/gh-routes'

// Drives the REAL handler (server/api/cards/sync.post.ts) with the REAL owner check and GitHub
// reader (server/utils/github.ts + github-core.ts) — only Nitro globals, global fetch, the card
// queries and the team lookup are stubbed (no D1 in vitest; the queries are generated CRUD).
// The fake GitHub (route table + switches on `gh`) lives in tests/helpers/gh-routes.ts (#4234).

const OWNER = 'owner@example.test'
let sessionEmail: string | null
let kv: ReturnType<typeof createStorage>

const createInboxCard = vi.fn(async (c: unknown) => c)
const updateInboxCard = vi.fn(async (..._a: unknown[]) => ({}))
const getAllInboxCards = vi.fn(async (..._a: unknown[]) => gh.existingCards)
vi.mock('../layers/inbox/collections/cards/server/database/queries', () => ({
  getAllInboxCards: (...a: unknown[]) => (getAllInboxCards as any)(...a),
  createInboxCard: (...a: unknown[]) => (createInboxCard as any)(...a),
  updateInboxCard: (...a: unknown[]) => (updateInboxCard as any)(...a)
}))
vi.mock('@fyit/crouton-auth/server/utils/team', () => ({
  resolveTeamAndCheckMembership: vi.fn(async () => ({ team: { id: 'team1' }, user: { id: 'u1' }, membership: { role: 'owner' } }))
}))
// The Pipeline board's rows (#4349): an in-memory table (no D1 in vitest).
vi.mock('../layers/pipeline/collections/items/server/database/queries', () => boardMock())

/** Promises the handler handed to event.waitUntil (work that must outlive the request). */
let waited: Promise<unknown>[]

/** Call the handler; returns its response promise unawaited (a browser that leaves never reads it). */
async function start() {
  vi.resetModules()
  vi.stubGlobal('defineEventHandler', (h: unknown) => h)
  vi.stubGlobal('defineCachedFunction', (fn: unknown) => fn)
  vi.stubGlobal('createError', createError)
  vi.stubGlobal('useRuntimeConfig', () => ({ statusOwnerEmail: OWNER }))
  vi.stubGlobal('useServerAuth', () => ({ api: { getSession: async () => (sessionEmail ? { user: { email: sessionEmail } } : null) } }))
  vi.stubGlobal('useStorage', () => kv)
  vi.stubGlobal('fetch', fetchSpy)
  const handler = (await import('../server/api/cards/sync.post')).default as unknown as (e: unknown) => Promise<any>
  const event = {
    headers: new Headers(),
    context: { cloudflare: { env: { GITHUB_TOKEN: 't' } } },
    waitUntil: (p: Promise<unknown>) => { waited.push(p) }
  }
  return { response: handler(event) }
}

async function run() {
  return (await start()).response.then(body => ({ status: 200, body }), (e: any) => ({ status: e.statusCode as number, body: null }))
}

beforeEach(() => {
  sessionEmail = OWNER
  resetGh()
  waited = []
  kv = createStorage({ driver: memory() })
  fetchSpy.mockClear()
  createInboxCard.mockReset()
  createInboxCard.mockImplementation(async (c: unknown) => c)
  updateInboxCard.mockReset()
  updateInboxCard.mockImplementation(async () => ({}))
  getAllInboxCards.mockReset()
  getAllInboxCards.mockImplementation(async () => gh.existingCards)
})

/** A stored waiting card whose ask left GitHub (it goes stale on a complete sync). */
const goneCard = (id: string, n: number, askedAt: string = OLD) =>
  ({ id, kind: 'issue', sourceType: 'issue', sourceNumber: n, sourceCommentId: 'gone', title: 'x', ask: 'x', link: 'x', state: 'waiting', askedAt })
afterEach(() => { vi.unstubAllGlobals() })

describe('POST /api/cards/sync', () => {
  // covers: T1
  it('#3880: the browser leaves mid-sync (reload, closed tab) → the sync still runs to the end and stores the cards', async () => {
    // On Workers a dropped request cancels its unfinished work unless it was handed to
    // waitUntil; the throttle stamp is already set, so a lost sync stores nothing for 60 s.
    const { response } = await start()
    response.catch(() => {}) // nobody reads the response: the page was reloaded
    await vi.waitFor(() => expect(waited).toHaveLength(1))
    await Promise.all(waited)
    expect(createInboxCard).toHaveBeenCalledTimes(2)
    // The reloaded page's sync is throttled, and the cards are already stored for it to list.
    fetchSpy.mockClear()
    expect((await run()).body).toMatchObject({ throttled: true })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  // covers: T1
  it('not the owner → 401, no GitHub call, no write', async () => {
    sessionEmail = 'someone@example.test'
    expect((await run()).status).toBe(401)
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(createInboxCard).not.toHaveBeenCalled()
  })

  // covers: T1
  it('owner → one review card per sign-off PR, then a second call < 60 s later is throttled with no GitHub call', async () => {
    const first = await run()
    expect(first.body).toEqual({ created: 2, updated: 0, stale: 0, answered: 0, stuck: { quiet: 0, draft: 0, epicSync: 0 } })
    expect(createInboxCard).toHaveBeenCalledTimes(2)
    expect((createInboxCard.mock.calls[0] as any[])[0]).toMatchObject({ kind: 'review', sourceType: 'pr', teamId: 'team1', owner: 'u1', state: 'waiting' })
    fetchSpy.mockClear()
    const second = await run()
    expect(second.body).toEqual({ created: 0, updated: 0, stale: 0, answered: 0, stuck: { quiet: 0, draft: 0, epicSync: 0 }, throttled: true })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  // covers: T1
  it('one item\'s comments read returns 500 → error + skipped, and no write for it', async () => {
    gh.failComments = 12
    const out = await run()
    expect(out.status).toBe(200)
    expect(out.body.error).toContain('GitHub 500')
    expect(out.body.skipped).toEqual([12])
    expect(out.body.created).toBe(1)
    expect(createInboxCard).toHaveBeenCalledTimes(1)
    expect((createInboxCard.mock.calls[0] as any[])[0].sourceNumber).toBe(10)
    expect(updateInboxCard).not.toHaveBeenCalled()
  })

  // covers: T1
  it('#3880: open PRs are read past page 1 — 100 old bot drafts on page 1, sign-off PRs on page 2', async () => {
    gh.pagedPulls = true
    const out = await run()
    expect(out.body.stuck).toEqual({ quiet: 0, draft: 100, epicSync: 0 })
    expect(out.body.created).toBe(102)
    const pages = fetchSpy.mock.calls.map(c => new URL(String(c[0]))).filter(u => u.pathname.endsWith('/pulls')).map(u => u.searchParams.get('page'))
    expect(pages).toEqual(['1', '2'])
  })

  // covers: T1
  it('#3880: epic-sync compares the branch against main\'s commit from the comment time', async () => {
    gh.epicBehind = 1 // e.g. a sub-PR merge moved the branch, but that main commit is still missing
    const out = await run()
    expect(out.body.stuck).toEqual({ quiet: 0, draft: 0, epicSync: 1 })
    const card = createInboxCard.mock.calls.map(c => (c as any[])[0]).find(c => c.sourceNumber === 900)
    expect(card).toMatchObject({ kind: 'issue', sourceType: 'issue', sourceCommentId: '9001', payload: { stuck: 'epic-sync', branch: EPIC_BRANCH } })
    expect(fetchSpy.mock.calls.some(c => String(c[0]).includes(`/compare/${MAIN_SHA}...${EPIC_BRANCH}`))).toBe(true)
  })

  // covers: T1
  it('#3880: epic-sync branch caught up (behind_by 0) or deleted (404) → no card, no error', async () => {
    for (const behind of [0, null]) {
      kv = createStorage({ driver: memory() })
      createInboxCard.mockClear()
      gh.epicBehind = behind
      const out = await run()
      expect(out.body.stuck.epicSync).toBe(0)
      expect(out.body.error).toBeUndefined()
      expect(out.body.skipped).toBeUndefined()
    }
  })

  // covers: T1
  it('#4233: every read succeeds (untyped search would be refused) → no error, and a waiting card whose ask is gone goes stale', async () => {
    gh.existingCards = [{ id: 'c1', kind: 'issue', sourceType: 'issue', sourceNumber: 77, sourceCommentId: 'gone', title: 'x', ask: 'x', link: 'x', state: 'waiting', askedAt: OLD }]
    const out = await run()
    expect(out.body.error).toBeUndefined()
    expect(out.body.stale).toBe(1)
    expect(updateInboxCard).toHaveBeenCalledWith('c1', 'team1', 'u1', { state: 'stale' }, { role: 'owner' })
  })

  // covers: T1
  it('#4233: a quiz on a PR and a quiz on an issue, each found by its own typed search → quiz cards pr + issue', async () => {
    gh.quizHits.pr = [{ number: 50, title: 'PR 50', html_url: 'https://github.com/o/r/pull/50', pull_request: {} }]
    gh.quizHits.issue = [{ number: 51, title: 'Issue 51', html_url: 'https://github.com/o/r/issues/51' }]
    for (const n of [50, 51]) {
      gh.quizComments[n] = [{
        id: 5000 + n, user: BOT, created_at: OLD, html_url: `https://github.com/o/r/issues/${n}#issuecomment-${5000 + n}`,
        body: `Quick check — PR #${n} reached main.\n\n<!-- owner-quiz:v1 pr=${n} sha=abc key=k1 -->`
      }]
    }
    const out = await run()
    expect(out.body.error).toBeUndefined()
    expect(out.body.created).toBe(4)
    const quiz = createInboxCard.mock.calls.map(c => (c as any[])[0]).filter(c => c.kind === 'quiz')
    expect(quiz.find(c => c.sourceNumber === 50)).toMatchObject({ sourceType: 'pr' })
    expect(quiz.find(c => c.sourceNumber === 51)).toMatchObject({ sourceType: 'issue' })
  })

  // covers: T1 (#4253)
  it('#4253: a stored waiting card with askedAt "not a date" → 200, left alone, the good ones still go stale', async () => {
    gh.existingCards = [goneCard('bad', 70, 'not a date'), goneCard('c1', 71), goneCard('c2', 72)]
    const out = await run()
    expect(out.status).toBe(200)
    expect(out.body.stale).toBe(2)
    const ids = updateInboxCard.mock.calls.map(c => c[0])
    expect(ids).toEqual(expect.arrayContaining(['c1', 'c2']))
    expect(ids).not.toContain('bad')
  })

  // covers: T3 (#4253)
  it('#4253: one card save fails → 200, every save still tried, error names it, counts cover successful saves only', async () => {
    gh.existingCards = [goneCard('c1', 71), goneCard('c2', 72), goneCard('c3', 73)]
    updateInboxCard.mockRejectedValueOnce(new Error('D1 limit'))
    const out = await run()
    expect(out.status).toBe(200)
    expect(updateInboxCard).toHaveBeenCalledTimes(3)
    expect(out.body.error).toContain('D1 limit')
    expect(out.body.error).toContain('1 card save(s) failed')
    expect(out.body.stale).toBe(2)
  })

  // covers: T4 (#4253)
  it('#4253: the stored-cards read fails → 200 with error, never a 500', async () => {
    getAllInboxCards.mockRejectedValueOnce(new Error('D1 read failed'))
    const out = await run()
    expect(out.status).toBe(200)
    expect(out.body.error).toContain('D1 read failed')
    expect(out.body).toMatchObject({ created: 0, updated: 0, stale: 0, answered: 0 })
    expect(createInboxCard).not.toHaveBeenCalled()
  })

  // covers: T5 (#4253)
  it('#4253: 202 creates + 50 stale updates with every 10th create failing → every write tried, no cap', async () => {
    const quiz = (n: number) => [{
      id: 50_000 + n, user: BOT, created_at: OLD, html_url: `https://github.com/o/r/issues/${n}#issuecomment-${50_000 + n}`,
      body: `Quick check — PR #${n} reached main.\n\n<!-- owner-quiz:v1 pr=${n} sha=abc key=k1 -->`
    }]
    gh.quizHits.issue = Array.from({ length: 100 }, (_, k) => ({ number: 2000 + k, title: `Issue ${2000 + k}`, html_url: `https://github.com/o/r/issues/${2000 + k}` }))
    gh.quizHits.pr = Array.from({ length: 100 }, (_, k) => ({ number: 3000 + k, title: `PR ${3000 + k}`, html_url: `https://github.com/o/r/pull/${3000 + k}`, pull_request: {} }))
    for (const i of [...gh.quizHits.issue, ...gh.quizHits.pr]) gh.quizComments[i.number] = quiz(i.number)
    gh.existingCards = Array.from({ length: 50 }, (_, k) => goneCard(`s${k}`, 6000 + k))
    let n = 0
    createInboxCard.mockImplementation(async (c: unknown) => {
      if (++n % 10 === 0) throw new Error('D1 busy')
      return c
    })
    const out = await run()
    expect(out.status).toBe(200)
    expect(createInboxCard).toHaveBeenCalledTimes(202)
    expect(updateInboxCard).toHaveBeenCalledTimes(50)
    expect(out.body.error).toContain('20 card save(s) failed')
    expect(out.body.created).toBe(182)
    expect(out.body.stale).toBe(50)
    expect(out.body).not.toHaveProperty('deferred')
  })

  // covers: T1
  it('#3785: 150 files over two pages, the only packages/ file on page 2 → the card still names it', async () => {
    gh.prFiles[10] = [
      ...Array.from({ length: 149 }, (_, i) => ({ filename: `pocs/status/f${i}.ts` })),
      { filename: 'packages/crouton-core/app/x.ts' }
    ]
    const out = await run()
    expect(out.body.created).toBe(2)
    const calls = createInboxCard.mock.calls.map(c => (c as any[])[0])
    const c10 = calls.find(c => c.sourceNumber === 10)
    expect(c10.payload.packages).toEqual([{ name: 'crouton-core', why: 'Adds a field to the core.', approval: null }])
    expect(calls.find(c => c.sourceNumber === 12).payload).not.toHaveProperty('packages')
    const fileUrls = fetchSpy.mock.calls.map(c => String(c[0])).filter(u => u.includes('/pulls/10/files'))
    expect(fileUrls.some(u => u.includes('page=2'))).toBe(true)
  })
})
