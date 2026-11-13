import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createError } from 'h3'
import { createStorage } from 'unstorage'
import memory from 'unstorage/drivers/memory'

// Drives the REAL handler (server/api/cards/sync.post.ts) with the REAL owner check and GitHub
// reader (server/utils/github.ts + github-core.ts) — only Nitro globals, global fetch, the card
// queries and the team lookup are stubbed (no D1 in vitest; the queries are generated CRUD).

const OWNER = 'owner@example.test'
const SIGNOFF = '<!-- deploy-preview: full-watch -->'
let sessionEmail: string | null
let kv: ReturnType<typeof createStorage>
let failComments: number | null

const createInboxCard = vi.fn(async (c: unknown) => c)
const updateInboxCard = vi.fn(async () => ({}))
vi.mock('../layers/inbox/collections/cards/server/database/queries', () => ({
  getAllInboxCards: vi.fn(async () => []),
  createInboxCard: (...a: unknown[]) => (createInboxCard as any)(...a),
  updateInboxCard: (...a: unknown[]) => (updateInboxCard as any)(...a)
}))
vi.mock('@fyit/crouton-auth/server/utils/team', () => ({
  resolveTeamAndCheckMembership: vi.fn(async () => ({ team: { id: 'team1' }, user: { id: 'u1' }, membership: { role: 'owner' } }))
}))

const BOT = { login: 'nuxt-harness[bot]', type: 'Bot' }
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } })

/** Fake GitHub: two bot sign-off PRs (#10, #12), nothing else waiting. */
const fetchSpy = vi.fn(async (input: string | URL | Request) => {
  const url = new URL(String(input))
  const p = url.pathname
  if (p.endsWith('/search/issues')) return json({ items: [] })
  if (p.endsWith('/issues') ) return json([])
  if (p.endsWith('/pulls')) {
    return json([10, 12].map(n => ({ number: n, title: `PR ${n}`, body: `Closes #${n + 1}\n${SIGNOFF}`, html_url: `https://github.com/o/r/pull/${n}`, user: BOT, labels: [], head: { sha: `sha${n}` } })))
  }
  const m = /\/issues\/(\d+)\/comments$/.exec(p)
  if (m) return Number(m[1]) === failComments ? json({ message: 'boom' }, 500) : json([])
  if (/\/issues\/\d+\/events$/.test(p)) return json([])
  const k = /\/pulls\/(\d+)\/commits$/.exec(p)
  if (k) return json([{ sha: `sha${k[1]}`, parents: [{}], commit: { message: 'feat', committer: { name: 'x', date: '2026-11-01T09:00:00Z' } } }])
  return json({ message: 'not found' }, 404)
})

async function run() {
  vi.resetModules()
  vi.stubGlobal('defineEventHandler', (h: unknown) => h)
  vi.stubGlobal('defineCachedFunction', (fn: unknown) => fn)
  vi.stubGlobal('createError', createError)
  vi.stubGlobal('useRuntimeConfig', () => ({ statusOwnerEmail: OWNER }))
  vi.stubGlobal('useServerAuth', () => ({ api: { getSession: async () => (sessionEmail ? { user: { email: sessionEmail } } : null) } }))
  vi.stubGlobal('useStorage', () => kv)
  vi.stubGlobal('fetch', fetchSpy)
  const handler = (await import('../server/api/cards/sync.post')).default as unknown as (e: unknown) => Promise<any>
  const event = { headers: new Headers(), context: { cloudflare: { env: { GITHUB_TOKEN: 't' } } } }
  return handler(event).then(body => ({ status: 200, body }), (e: any) => ({ status: e.statusCode as number, body: null }))
}

beforeEach(() => {
  sessionEmail = OWNER
  failComments = null
  kv = createStorage({ driver: memory() })
  fetchSpy.mockClear()
  createInboxCard.mockClear()
  updateInboxCard.mockClear()
})
afterEach(() => { vi.unstubAllGlobals() })

describe('POST /api/cards/sync', () => {
  it('not the owner → 401, no GitHub call, no write', async () => {
    sessionEmail = 'someone@example.test'
    expect((await run()).status).toBe(401)
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(createInboxCard).not.toHaveBeenCalled()
  })

  it('owner → one review card per sign-off PR, then a second call < 60 s later is throttled with no GitHub call', async () => {
    const first = await run()
    expect(first.body).toEqual({ created: 2, updated: 0, stale: 0, answered: 0 })
    expect(createInboxCard).toHaveBeenCalledTimes(2)
    expect((createInboxCard.mock.calls[0] as any[])[0]).toMatchObject({ kind: 'review', sourceType: 'pr', teamId: 'team1', owner: 'u1', state: 'waiting' })
    fetchSpy.mockClear()
    const second = await run()
    expect(second.body).toEqual({ created: 0, updated: 0, stale: 0, answered: 0, throttled: true })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('one item\'s comments read returns 500 → error + skipped, and no write for it', async () => {
    failComments = 12
    const out = await run()
    expect(out.status).toBe(200)
    expect(out.body.error).toContain('GitHub 500')
    expect(out.body.skipped).toEqual([12])
    expect(out.body.created).toBe(1)
    expect(createInboxCard).toHaveBeenCalledTimes(1)
    expect((createInboxCard.mock.calls[0] as any[])[0].sourceNumber).toBe(10)
    expect(updateInboxCard).not.toHaveBeenCalled()
  })
})
