import { vi } from 'vitest'

// The fake GitHub the card-sync tests read (#4234): moved out of cards-sync-endpoint.test.ts so the
// endpoint test (T1) and the runCardsSync test (T2) answer from the same route table. Default:
// two bot sign-off PRs (#10, #12) and nothing else waiting. Each test flips a switch on `gh`
// (after `resetGh()` in its beforeEach).

const SIGNOFF = '<!-- deploy-preview: full-watch -->'
const EPIC_COMMENT_AT = '2026-11-10T12:00:00Z'
export const EPIC_BRANCH = 'epic/900-thing'
export const MAIN_SHA = 'mainsha900'
export const BOT = { login: 'nuxt-harness[bot]', type: 'Bot' }
export const OLD = '2026-11-01T00:00:00Z'

export const gh = {
  /** Issue/PR number whose comments read returns 500. */
  failComments: null as number | null,
  /** #3880: page 1 of open PRs is 100 bot drafts (#1000–#1099) and page 2 holds the sign-off PRs. */
  pagedPulls: false,
  /** #3880: one open epic (#900) with a bot conflict comment; `behind_by` of the compare. */
  epicBehind: undefined as number | null | undefined,
  /** PR number → its changed files (served 100 per page); unset → no files. */
  prFiles: {} as Record<number, Array<{ filename: string }>>,
  /** #4233: cards already stored before the sync. */
  existingCards: [] as unknown[],
  /** #4233: quiz search hits, served only to the matching typed search. */
  quizHits: { issue: [] as any[], pr: [] as any[] },
  /** #4233: issue/PR number → its comments (quiz comments). */
  quizComments: {} as Record<number, unknown[]>,
  /** #4349: issues served by the `labels=<label>` issue lists (blocked, to-test, work-this, …). */
  labelled: {} as Record<string, any[]>,
  /** #4349: the `labels=<label>` issue list that answers 500. */
  failList: null as string | null,
  /** #4349: the in-memory `pipeline_items` table (see `boardQueries`). */
  board: [] as any[],
  /** #4349: board writes made by the sync, in order. */
  boardWrites: [] as Array<{ op: 'create' | 'update' | 'delete', id?: string, data?: any }>
}

/**
 * In-memory stand-in for the generated `pipeline_items` queries (no D1 in vitest). Mock the module
 * with `boardMock()` called lazily from the factory, so it reads THIS module's `gh` (the tests'
 * `vi.resetModules()` would otherwise hand the factory a fresh copy):
 * `vi.mock('../layers/pipeline/collections/items/server/database/queries', () => boardMock())`.
 */
export const boardQueries = {
  getAllPipelineItems: vi.fn(async () => gh.board.map(r => ({ ...r }))),
  createPipelineItem: vi.fn(async (data: any) => {
    const row = { id: `row${gh.board.length + 1}`, ...data }
    gh.board.push(row)
    gh.boardWrites.push({ op: 'create', data })
    return row
  }),
  updatePipelineItem: vi.fn(async (id: string, _team: string, _user: string, patch: any) => {
    const row = gh.board.find(r => r.id === id)
    Object.assign(row, patch)
    gh.boardWrites.push({ op: 'update', id, data: patch })
    return row
  }),
  deletePipelineItem: vi.fn(async (id: string) => {
    gh.board = gh.board.filter(r => r.id !== id)
    gh.boardWrites.push({ op: 'delete', id })
    return { success: true }
  })
}
/** The module shape for `vi.mock`: each query calls `boardQueries` at call time. */
export const boardMock = () => ({
  getAllPipelineItems: (...a: unknown[]) => (boardQueries.getAllPipelineItems as any)(...a),
  createPipelineItem: (...a: unknown[]) => (boardQueries.createPipelineItem as any)(...a),
  updatePipelineItem: (...a: unknown[]) => (boardQueries.updatePipelineItem as any)(...a),
  deletePipelineItem: (...a: unknown[]) => (boardQueries.deletePipelineItem as any)(...a)
})

export function resetGh() {
  gh.failComments = null
  gh.pagedPulls = false
  gh.epicBehind = undefined
  gh.prFiles = {}
  gh.existingCards = []
  gh.quizHits = { issue: [], pr: [] }
  gh.quizComments = {}
  gh.labelled = {}
  gh.failList = null
  gh.board = []
  gh.boardWrites = []
  for (const f of Object.values(boardQueries)) f.mockClear()
  fetchSpy.mockClear()
}

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } })

const signoffPulls = () => [10, 12].map(n => ({ number: n, title: `PR ${n}`, body: `Closes #${n + 1}\n${SIGNOFF}`, html_url: `https://github.com/o/r/pull/${n}`, user: BOT, labels: [], head: { sha: `sha${n}` }, base: { ref: 'main' }, updated_at: OLD }))
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
  if (q.includes('reached main')) return json({ items: q.includes('is:pull-request') ? gh.quizHits.pr : gh.quizHits.issue })
  const epicSearch = q.includes('no longer merges cleanly with main')
  return json({ items: epicSearch && gh.epicBehind !== undefined ? [EPIC_ISSUE] : [] })
}
function pullsRoute(url: URL) {
  if (!gh.pagedPulls) return json(signoffPulls())
  return json(url.searchParams.get('page') === '1' ? draftPulls() : signoffPulls())
}
const mainCommitsRoute = (url: URL) => json(url.searchParams.get('until') === EPIC_COMMENT_AT ? [{ sha: MAIN_SHA }] : [])
function compareRoute(url: URL) {
  if (!url.pathname.endsWith(`/compare/${MAIN_SHA}...${EPIC_BRANCH}`)) return json({ message: 'wrong base' }, 422)
  return gh.epicBehind === null ? json({ message: 'Not Found' }, 404) : json({ behind_by: gh.epicBehind })
}
function commentsRoute(n: number) {
  if (n === 900) return json([EPIC_CONFLICT])
  if (gh.quizComments[n]) return json(gh.quizComments[n])
  return n === gh.failComments ? json({ message: 'boom' }, 500) : json([])
}
function prFilesRoute(url: URL, n: number) {
  const page = Number(url.searchParams.get('page') ?? 1)
  return json((gh.prFiles[n] ?? []).slice((page - 1) * 100, page * 100))
}
const prCommitsRoute = (n: string) => json([{ sha: `sha${n}`, parents: [{}], commit: { message: 'feat', committer: { name: 'x', date: '2026-11-01T09:00:00Z' } } }])

/** Path matcher → response; first match wins. */
const ROUTES: Array<[RegExp, (url: URL, m: RegExpExecArray) => Response]> = [
  [/\/search\/issues$/, url => searchRoute(url)],
  [/\/issues$/, (url) => {
    const label = url.searchParams.get('labels') ?? ''
    return label === gh.failList ? json({ message: 'boom' }, 500) : json(gh.labelled[label] ?? [])
  }],
  [/\/pulls$/, url => pullsRoute(url)],
  [/\/repos\/[^/]+\/[^/]+\/commits$/, url => mainCommitsRoute(url)],
  [/\/compare\//, url => compareRoute(url)],
  [/\/issues\/(\d+)\/comments$/, (_u, m) => commentsRoute(Number(m[1]))],
  [/\/issues\/\d+\/events$/, () => json([])],
  [/\/pulls\/(\d+)\/commits$/, (_u, m) => prCommitsRoute(m[1]!)],
  [/\/pulls\/(\d+)\/files$/, (url, m) => prFilesRoute(url, Number(m[1]))],
  [/\/issues\/\d+$/, () => json({ body: '## 👤 For humans\nAdds a field to the core.\n\n## 🤖 For agents\n- x' })]
]

/** Fake GitHub as a global `fetch`: answers from ROUTES, 404 otherwise. */
export const fetchSpy = vi.fn(async (input: string | URL | Request, _init?: RequestInit) => {
  const url = new URL(String(input))
  for (const [re, route] of ROUTES) {
    const m = re.exec(url.pathname)
    if (m) return route(url, m)
  }
  return json({ message: 'not found' }, 404)
})
