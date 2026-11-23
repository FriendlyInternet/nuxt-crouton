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
  quizComments: {} as Record<number, unknown[]>
}

export function resetGh() {
  gh.failComments = null
  gh.pagedPulls = false
  gh.epicBehind = undefined
  gh.prFiles = {}
  gh.existingCards = []
  gh.quizHits = { issue: [], pr: [] }
  gh.quizComments = {}
  fetchSpy.mockClear()
}

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } })

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

/** Fake GitHub as a global `fetch`: answers from ROUTES, 404 otherwise. */
export const fetchSpy = vi.fn(async (input: string | URL | Request, _init?: RequestInit) => {
  const url = new URL(String(input))
  for (const [re, route] of ROUTES) {
    const m = re.exec(url.pathname)
    if (m) return route(url, m)
  }
  return json({ message: 'not found' }, 404)
})
