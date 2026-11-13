import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createError } from 'h3'
import { answerCard, tokenLogin } from '../server/utils/cards-answer-core'

// Never hits real GitHub: a real `ok` on an open epic or PR can start a merge. fetch is mocked.

const ASKED = new Date('2026-11-10T12:00:00.000Z')
const NOW = new Date('2026-11-13T09:00:00.000Z')
const card = (kind = 'review') => ({ kind, sourceType: 'issue', sourceNumber: 42, askedAt: ASKED })
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })

interface Call { url: string, method: string, body?: string }

/** Route-aware fake GitHub: /user → login; GET comments → `comments`; POST comments → `postStatus`. */
function fakeGh(opts: { login?: string, comments?: unknown[], postStatus?: number } = {}) {
  const calls: Call[] = []
  const f = vi.fn(async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? 'GET'
    calls.push({ url, method, body: init.body as string | undefined })
    if (url.endsWith('/user')) return json({ login: opts.login ?? 'pmcp' })
    if (method === 'GET') return json(opts.comments ?? [])
    const status = opts.postStatus ?? 201
    return status >= 300 ? json({}, status) : json({ html_url: 'https://github.com/o/r/issues/42#issuecomment-1' }, status)
  })
  return { f: f as unknown as typeof fetch, calls }
}
const posts = (calls: Call[]) => calls.filter(c => c.method === 'POST')
const run = (c: ReturnType<typeof card>, input: Record<string, unknown>, f: typeof fetch) =>
  answerCard({ card: c, input, repo: 'o/r', token: 't', fetchImpl: f, now: NOW })

describe('answerCard', () => {
  it('1. review ok → posts exactly "ok" on the source and marks the card answered', async () => {
    const { f, calls } = fakeGh()
    const r = await run(card(), { verdict: 'ok' }, f)
    expect(r.error).toBeNull()
    const p = posts(calls)
    expect(p).toHaveLength(1)
    expect(p[0].url).toBe('https://api.github.com/repos/o/r/issues/42/comments')
    expect(JSON.parse(p[0].body!)).toEqual({ body: 'ok' })
    expect(r.data!.updates).toEqual({
      state: 'answered',
      answer: 'ok',
      answerNote: null,
      answeredVia: 'inbox',
      answerUrl: 'https://github.com/o/r/issues/42#issuecomment-1',
      answeredAt: NOW
    })
  })

  it('2. review not-ok with no note → 400, no post', async () => {
    const { f, calls } = fakeGh()
    const r = await run(card(), { verdict: 'not-ok' }, f)
    expect(r.status).toBe(400)
    expect(r.data).toBeNull()
    expect(posts(calls)).toHaveLength(0)
  })

  it('3. review not-ok with a note → "not ok: <note>", note stored', async () => {
    const { f, calls } = fakeGh()
    const r = await run(card(), { verdict: 'not-ok', note: ' rename the field ' }, f)
    expect(JSON.parse(posts(calls)[0].body!)).toEqual({ body: 'not ok: rename the field' })
    expect(r.data!.updates!.answerNote).toBe('rename the field')
    expect(r.data!.updates!.answer).toBe('not-ok')
  })

  it('4. choice cards are not answerable in v1 → 400', async () => {
    const { f, calls } = fakeGh()
    const r = await run(card('choice'), { verdict: 'ok' }, f)
    expect(r.status).toBe(400)
    expect(r.error).toMatch(/"choice" cards are not supported/)
    expect(posts(calls)).toHaveLength(0)
  })

  it('5. quiz and edit cards with verdict ok → 400 and no "ok" is posted', async () => {
    for (const kind of ['quiz', 'edit']) {
      const { f, calls } = fakeGh()
      const r = await run(card(kind), { verdict: 'ok' }, f)
      expect(r.status).toBe(400)
      expect(posts(calls).some(c => JSON.parse(c.body!).body === 'ok')).toBe(false)
    }
  })

  it('6. an identical ok older than askedAt does not block a new comment', async () => {
    const { f, calls } = fakeGh({ comments: [{ body: 'ok', html_url: 'old-schema-signoff', created_at: '2026-11-01T00:00:00Z' }] })
    const r = await run(card(), { verdict: 'ok' }, f)
    expect(posts(calls)).toHaveLength(1)
    expect(r.data!.existing).toBe(false)
  })

  it('7. the comments request carries since=<askedAt ISO>', async () => {
    const { f, calls } = fakeGh()
    await run(card(), { verdict: 'ok' }, f)
    const list = calls.find(c => c.method === 'GET' && c.url.includes('/comments'))!
    expect(list.url).toContain(`since=${encodeURIComponent(ASKED.toISOString())}`)
  })

  it('8. an identical ok newer than askedAt → existing, no post, no updates', async () => {
    const { f, calls } = fakeGh({ comments: [{ body: 'ok', html_url: 'already', created_at: '2026-11-11T00:00:00Z' }] })
    const r = await run(card(), { verdict: 'ok' }, f)
    expect(posts(calls)).toHaveLength(0)
    expect(r.data).toEqual({ url: 'already', existing: true, updates: null })
  })

  it('9. GitHub POST 500 → error, no updates (card stays waiting)', async () => {
    const { f } = fakeGh({ postStatus: 500 })
    const r = await run(card(), { verdict: 'ok' }, f)
    expect(r.status).toBe(502)
    expect(r.error).toMatch(/500/)
    expect(r.data).toBeNull()
  })

  it('10. token that is not the owner → 403 for every kind, no comments request, no updates', async () => {
    for (const kind of ['review', 'choice', 'quiz', 'edit', 'delivery']) {
      const { f, calls } = fakeGh({ login: 'some-bot[bot]' })
      const r = await run(card(kind), { verdict: 'ok' }, f)
      expect(r.status).toBe(403)
      expect(r.error).toBe('the app\'s GitHub token is not the owner\'s account (posts as some-bot[bot])')
      expect(calls.some(c => c.url.includes('/comments'))).toBe(false)
      expect(r.data).toBeNull()
    }
  })

  it('11. tokenLogin without a token → GITHUB_TOKEN is not configured', async () => {
    expect((await tokenLogin(undefined)).error).toBe('GITHUB_TOKEN is not configured')
  })
})

// Drives the REAL handler (server/api/cards/[cardId]/answer.post.ts) with Nitro globals stubbed.
// Guards "the card is only marked answered when GitHub took the reply".
const updateInboxCard = vi.fn(async () => ({}))
vi.mock('../layers/inbox/collections/cards/server/database/queries', () => ({
  getInboxCardsByIds: vi.fn(async () => [{ id: 'c1', kind: 'review', sourceType: 'issue', sourceNumber: 42, askedAt: ASKED }]),
  updateInboxCard: (...args: unknown[]) => (updateInboxCard as any)(...args)
}))
vi.mock('@fyit/crouton-auth/server/utils/team', () => ({
  resolveTeamAndCheckMembership: vi.fn(async () => ({ team: { id: 'team1' }, user: { id: 'u1' }, membership: { role: 'owner' } }))
}))
vi.mock('../server/utils/github', () => ({
  githubToken: () => 't',
  requireStatusOwner: async () => {}
}))

describe('POST /api/cards/[cardId]/answer', () => {
  beforeEach(() => {
    updateInboxCard.mockClear()
    vi.stubGlobal('defineEventHandler', (h: unknown) => h)
    vi.stubGlobal('createError', createError)
    vi.stubGlobal('getRouterParam', (_e: unknown, name: string) => (name === 'cardId' ? 'c1' : undefined))
    vi.stubGlobal('readBody', async () => ({ verdict: 'ok' }))
  })
  afterEach(() => { vi.unstubAllGlobals() })

  async function handle() {
    const handler = (await import('../server/api/cards/[cardId]/answer.post')).default as unknown as (e: unknown) => Promise<any>
    return handler({ headers: new Headers() }).then(r => ({ ok: true as const, r }), (e: any) => ({ ok: false as const, status: e.statusCode as number }))
  }

  it('GitHub POST fails → 502 and updateInboxCard is not called', async () => {
    vi.stubGlobal('fetch', fakeGh({ postStatus: 500 }).f)
    const out = await handle()
    expect(out).toEqual({ ok: false, status: 502 })
    expect(updateInboxCard).not.toHaveBeenCalled()
  })

  it('GitHub POST succeeds → updateInboxCard called once with state answered', async () => {
    vi.stubGlobal('fetch', fakeGh().f)
    const out = await handle()
    expect(out.ok).toBe(true)
    expect(updateInboxCard).toHaveBeenCalledTimes(1)
    const [id, teamId, userId, updates, opts] = updateInboxCard.mock.calls[0] as unknown as [string, string, string, any, any]
    expect([id, teamId, userId, opts]).toEqual(['c1', 'team1', 'u1', { role: 'owner' }])
    expect(updates.state).toBe('answered')
    expect(updates.answeredVia).toBe('inbox')
  })
})
