import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createError } from 'h3'

// Drives the REAL handler (server/api/cards/[cardId]/answer.post.ts) with a stored `delivery` card.
// This ticket's mapping only: Works → `ok`, Not ok + note → `not ok: <note>`. fetch is mocked —
// a real `ok` on an epic can start a merge.

const ASKED = new Date('2026-11-10T12:00:00.000Z')
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })

interface Call { url: string, method: string, body?: string }
function fakeGh(comments: unknown[] = []) {
  const calls: Call[] = []
  const f = vi.fn(async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? 'GET'
    calls.push({ url, method, body: init.body as string | undefined })
    if (url.endsWith('/user')) return json({ login: 'pmcp' })
    if (method === 'GET') return json(comments)
    return json({ html_url: 'https://github.com/o/r/issues/77#issuecomment-9' }, 201)
  })
  return { f: f as unknown as typeof fetch, calls }
}
const posts = (calls: Call[]) => calls.filter(c => c.method === 'POST')

const updateInboxCard = vi.fn(async () => ({}))
vi.mock('../layers/inbox/collections/cards/server/database/queries', () => ({
  getInboxCardsByIds: vi.fn(async () => [{ id: 'd1', kind: 'delivery', sourceType: 'issue', sourceNumber: 77, askedAt: ASKED }]),
  updateInboxCard: (...args: unknown[]) => (updateInboxCard as any)(...args)
}))
vi.mock('@fyit/crouton-auth/server/utils/team', () => ({
  resolveTeamAndCheckMembership: vi.fn(async () => ({ team: { id: 'team1' }, user: { id: 'u1' }, membership: { role: 'owner' } }))
}))
vi.mock('../server/utils/github', () => ({
  githubToken: () => 't',
  requireStatusOwner: async () => {}
}))

describe('POST /api/cards/[cardId]/answer — delivery card', () => {
  let body: Record<string, unknown> = {}
  beforeEach(() => {
    updateInboxCard.mockClear()
    vi.stubGlobal('defineEventHandler', (h: unknown) => h)
    vi.stubGlobal('createError', createError)
    vi.stubGlobal('getRouterParam', (_e: unknown, name: string) => (name === 'cardId' ? 'd1' : undefined))
    vi.stubGlobal('readBody', async () => body)
  })
  afterEach(() => { vi.unstubAllGlobals() })

  async function handle() {
    const handler = (await import('../server/api/cards/[cardId]/answer.post')).default as unknown as (e: unknown) => Promise<any>
    return handler({ headers: new Headers() }).then(r => ({ ok: true as const, r }), (e: any) => ({ ok: false as const, status: e.statusCode as number }))
  }

  it('works → posts exactly "ok" on the epic, even when the epic already has an earlier ok', async () => {
    body = { kind: 'delivery', verdict: 'works' }
    // The signed-off epic's old `ok`, from before the card was asked — must not count as a duplicate.
    const gh = fakeGh([{ body: 'ok', created_at: '2026-11-01T00:00:00Z', html_url: 'old' }])
    vi.stubGlobal('fetch', gh.f)
    const out = await handle()
    expect(out.ok).toBe(true)
    const p = posts(gh.calls)
    expect(p).toHaveLength(1)
    expect(p[0]!.url).toBe('https://api.github.com/repos/FriendlyInternet/nuxt-crouton/issues/77/comments')
    expect(JSON.parse(p[0]!.body!)).toEqual({ body: 'ok' })
    expect(updateInboxCard).toHaveBeenCalledTimes(1)
    const updates = (updateInboxCard.mock.calls[0] as unknown as any[])[3]
    expect(updates.answer).toBe('works')
    expect(updates.state).toBe('answered')
  })

  it('not-ok with a note → posts "not ok: <note>"', async () => {
    body = { kind: 'delivery', verdict: 'not-ok', note: ' the login loops ' }
    const gh = fakeGh()
    vi.stubGlobal('fetch', gh.f)
    const out = await handle()
    expect(out.ok).toBe(true)
    expect(JSON.parse(posts(gh.calls)[0]!.body!)).toEqual({ body: 'not ok: the login loops' })
  })

  it('a review verdict (ok) on a delivery card → 400, nothing posted', async () => {
    body = { verdict: 'ok' }
    const gh = fakeGh()
    vi.stubGlobal('fetch', gh.f)
    expect(await handle()).toEqual({ ok: false, status: 400 })
    expect(posts(gh.calls)).toHaveLength(0)
  })
})
