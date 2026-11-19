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
/** #3880: page 1 of open PRs is 100 bot drafts (#1000–#1099) and page 2 holds the sign-off PRs. */
let pagedPulls: boolean
/** #3880: one open epic (#900) with a bot conflict comment; `behind_by` of the compare. */
let epicBehind: number | null | undefined
const EPIC_COMMENT_AT = '2026-11-10T12:00:00Z'
const EPIC_BRANCH = 'epic/900-thing'
const MAIN_SHA = 'mainsha900'
/** PR number → its changed files (served 100 per page); unset → no files. */
let prFiles: Record<number, Array<{ filename: string }>>
/** #4233: cards already stored before the sync. */
let existingCards: unknown[]
/** #4233: quiz search hits, served only to the matching typed search. */
let quizHits: { issue: any[], pr: any[] }
/** #4233: issue/PR number → its comments (quiz comments). */
let quizComments: Record<number, unknown[]>

const createInboxCard = vi.fn(async (c: unknown) => c)
const updateInboxCard = vi.fn(async () => ({}))
vi.mock('../layers/inbox/collections/cards/server/database/queries', () => ({
  getAllInboxCards: vi.fn(async () => existingCards),
  createInboxCard: (...a: unknown[]) => (createInboxCard as any)(...a),
  updateInboxCard: (...a: unknown[]) => (updateInboxCard as any)(...a)
}))
vi.mock('@fyit/crouton-auth/server/utils/team', () => ({
  resolveTeamAndCheckMembership: vi.fn(async () => ({ team: { id: 'team1' }, user: { id: 'u1' }, membership: { role: 'owner' } }))
}))

const BOT = { login: 'nuxt-harness[bot]', type: 'Bot' }
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } })

const OLD = '2026-11-01T00:00:00Z'
const signoffPulls = () => [10, 12].map(n => ({ number: n, title: `PR ${n}`, body: `Closes #${n + 1}\n${SIGNOFF}`, html_url: `https://github.com/o/r/pull/${n}`, user: BOT, labels: [], head: { sha: `sha${n}` }, updated_at: OLD }))
const draftPulls = () => Array.from({ length: 100 }, (_, k) => ({ number: 1000 + k, title: `Draft ${k}`, body: '', html_url: `https://github.com/o/r/pull/${1000 + k}`, user: BOT, labels: [], head: { sha: `d${k}` }, draft: true, updated_at: OLD }))

const EPIC_ISSUE = { number: 900, title: 'Epic 900', body: '', html_url: 'https://github.com/o/r/issues/900', labels: [{ name: 'epic' }] }
const EPIC_CONFLICT = {
  id: 9001, user: BOT, created_at: EPIC_COMMENT_AT, html_url: 'https://github.com/o/r/issues/900#issuecomment-9001',
  body: `<!-- epic-sync:conflict -->\n> 🤖 sync\n\nThe epic branch no longer merges cleanly with main. Someone needs to merge \`main\` into \`${EPIC_BRANCH}\` and resolve the conflicts.`
}

function searchRoute(url: URL) {
  const q = url.searchParams.get('q') ?? ''
  // GitHub refuses a search that names neither type (#4233).
  if (!q.includes('is:issue') && !q.includes('is:pull-request')) {
    return json({ message: "Query must include 'is:issue' or 'is:pull-request'" }, 422)
  }
  if (q.includes('reached main')) return json({ items: q.includes('is:pull-request') ? quizHits.pr : quizHits.issue })
  const epicSearch = q.includes('no longer merges cleanly with main')
  return json({ items: epicSearch && epicBehind !== undefined ? [EPIC_ISSUE] : [] })
}
function pullsRoute(url: URL) {
  if (!pagedPulls) return json(signoffPulls())
  return json(url.searchParams.get('page') === '1' ? draftPulls() : signoffPulls())
}
const mainCommitsRoute = (url: URL) => json(url.searchParams.get('until') === EPIC_COMMENT_AT ? [{ sha: MAIN_SHA }] : [])
function compareRoute(url: URL) {
  if (!url.pathname.endsWith(`/compare/${MAIN_SHA}...${EPIC_BRANCH}`)) return json({ message: 'wrong base' }, 422)
  return epicBehind === null ? json({ message: 'Not Found' }, 404) : json({ behind_by: epicBehind })
}
function commentsRoute(n: number) {
  if (n === 900) return json([EPIC_CONFLICT])
  if (quizComments[n]) return json(quizComments[n])
  return n === failComments ? json({ message: 'boom' }, 500) : json([])
}
function prFilesRoute(url: URL, n: number) {
  const page = Number(url.searchParams.get('page') ?? 1)
  return json((prFiles[n] ?? []).slice((page - 1) * 100, page * 100))
}
const prCommitsRoute = (n: string) => json([{ sha: `sha${n}`, parents: [{}], commit: { message: 'feat', committer: { name: 'x', date: '2026-11-01T09:00:00Z' } } }])

/** Path matcher → response; first match wins. */
const ROUTES: Array<[RegExp, (url: URL, m: RegExpExecArray) => Response]> = [
  [/\/search\/issues$/, url => searchRoute(url)],
  [/\/issues$/, () => json([])],
  [/\/pulls$/, url => pullsRoute(url)],
  [/\/repos\/[^/]+\/[^/]+\/commits$/, url => mainCommitsRoute(url)],
  [/\/compare\//, url => compareRoute(url)],
  [/\/issues\/(\d+)\/comments$/, (_u, m) => commentsRoute(Number(m[1]))],
  [/\/issues\/\d+\/events$/, () => json([])],
  [/\/pulls\/(\d+)\/commits$/, (_u, m) => prCommitsRoute(m[1]!)],
  [/\/pulls\/(\d+)\/files$/, (url, m) => prFilesRoute(url, Number(m[1]))],
  [/\/issues\/\d+$/, () => json({ body: '## 👤 For humans\nAdds a field to the core.\n\n## 🤖 For agents\n- x' })]
]

/** Fake GitHub: two bot sign-off PRs (#10, #12), nothing else waiting (unless #3880's switches are on). */
const fetchSpy = vi.fn(async (input: string | URL | Request) => {
  const url = new URL(String(input))
  for (const [re, route] of ROUTES) {
    const m = re.exec(url.pathname)
    if (m) return route(url, m)
  }
  return json({ message: 'not found' }, 404)
})

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
  failComments = null
  pagedPulls = false
  epicBehind = undefined
  prFiles = {}
  existingCards = []
  quizHits = { issue: [], pr: [] }
  quizComments = {}
  waited = []
  kv = createStorage({ driver: memory() })
  fetchSpy.mockClear()
  createInboxCard.mockClear()
  updateInboxCard.mockClear()
})
afterEach(() => { vi.unstubAllGlobals() })

describe('POST /api/cards/sync', () => {
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

  it('not the owner → 401, no GitHub call, no write', async () => {
    sessionEmail = 'someone@example.test'
    expect((await run()).status).toBe(401)
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(createInboxCard).not.toHaveBeenCalled()
  })

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

  it('#3880: open PRs are read past page 1 — 100 old bot drafts on page 1, sign-off PRs on page 2', async () => {
    pagedPulls = true
    const out = await run()
    expect(out.body.stuck).toEqual({ quiet: 0, draft: 100, epicSync: 0 })
    expect(out.body.created).toBe(102)
    const pages = fetchSpy.mock.calls.map(c => new URL(String(c[0]))).filter(u => u.pathname.endsWith('/pulls')).map(u => u.searchParams.get('page'))
    expect(pages).toEqual(['1', '2'])
  })

  it('#3880: epic-sync compares the branch against main\'s commit from the comment time', async () => {
    epicBehind = 1 // e.g. a sub-PR merge moved the branch, but that main commit is still missing
    const out = await run()
    expect(out.body.stuck).toEqual({ quiet: 0, draft: 0, epicSync: 1 })
    const card = createInboxCard.mock.calls.map(c => (c as any[])[0]).find(c => c.sourceNumber === 900)
    expect(card).toMatchObject({ kind: 'issue', sourceType: 'issue', sourceCommentId: '9001', payload: { stuck: 'epic-sync', branch: EPIC_BRANCH } })
    expect(fetchSpy.mock.calls.some(c => String(c[0]).includes(`/compare/${MAIN_SHA}...${EPIC_BRANCH}`))).toBe(true)
  })

  it('#3880: epic-sync branch caught up (behind_by 0) or deleted (404) → no card, no error', async () => {
    for (const behind of [0, null]) {
      kv = createStorage({ driver: memory() })
      createInboxCard.mockClear()
      epicBehind = behind
      const out = await run()
      expect(out.body.stuck.epicSync).toBe(0)
      expect(out.body.error).toBeUndefined()
      expect(out.body.skipped).toBeUndefined()
    }
  })

  it('#4233: every read succeeds (untyped search would be refused) → no error, and a waiting card whose ask is gone goes stale', async () => {
    existingCards = [{ id: 'c1', kind: 'issue', sourceType: 'issue', sourceNumber: 77, sourceCommentId: 'gone', title: 'x', ask: 'x', link: 'x', state: 'waiting', askedAt: OLD }]
    const out = await run()
    expect(out.body.error).toBeUndefined()
    expect(out.body.stale).toBe(1)
    expect(updateInboxCard).toHaveBeenCalledWith('c1', 'team1', 'u1', { state: 'stale' }, { role: 'owner' })
  })

  it('#4233: a quiz on a PR and a quiz on an issue, each found by its own typed search → quiz cards pr + issue', async () => {
    quizHits.pr = [{ number: 50, title: 'PR 50', html_url: 'https://github.com/o/r/pull/50', pull_request: {} }]
    quizHits.issue = [{ number: 51, title: 'Issue 51', html_url: 'https://github.com/o/r/issues/51' }]
    for (const n of [50, 51]) {
      quizComments[n] = [{
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

  it('#3785: 150 files over two pages, the only packages/ file on page 2 → the card still names it', async () => {
    prFiles[10] = [
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
