// The inbox card sync (#4234): read GitHub live and upsert one inbox card per ask that waits on the owner.
// → { created, updated, stale, answered, stuck: { quiet, draft, epicSync }, error?, skipped? }
// Needs no request: it takes the GitHub token, the team and the owner, so both POST /api/cards/sync
// (the inbox page on load) and the clock (server/utils/cards-sync-clock.ts, :00 and :30, or after a GitHub change) run it.
// Rules: server/utils/cards-sync-core.ts. A failed GitHub read never changes a card: the item is
// skipped (listed in `skipped`) and the next sync tries again. A card whose ticket a chat claimed
// carries `payload.claim` (#4019, server/utils/claim-core.ts).
// At the end it also writes the Pipeline board (`pipeline_items`, #4349) from the lists it already
// read — no extra GitHub reads (rules: server/utils/board-core.ts `boardFromLists`).
import { createInboxCard, getAllInboxCards, updateInboxCard } from '../../layers/inbox/collections/cards/server/database/queries'
import { createPipelineItem, deletePipelineItem, getAllPipelineItems, updatePipelineItem } from '../../layers/pipeline/collections/items/server/database/queries'
import { boardFromLists, closesIssue, type BoardItem, type BoardPlan } from './board-core'
import { ghFetch, type GhSource } from './github'
import { ghGetAll } from './gh-paged'
import {
  EPIC_SYNC_TEXT, PIPELINE_LABELS, SIGNOFF_PREVIEW_MARKER, cardKey, collectAsks, epicSyncBranch, epicSyncComment,
  goneCandidates, isPipelineBot, planSync, stuckCounts,
  type Ask, type EpicSyncItem, type ExistingCard, type GhComment, type GhCommit, type GhEvent, type GhFile, type GhUser, type QuizItem, type SyncItem
} from './cards-sync-core'
import { MAX_HOPS, activeClaim, applyClaims, claimsByTicket, type CardClaim } from './claim-core'

const REPO = 'FriendlyInternet/nuxt-crouton'
/** A team's sync is skipped when its last one started < 60 s ago (endpoint and clock share the key). */
export const THROTTLE_MS = 60_000
const QUIZ_DAYS = 14

interface GhLabel { name?: string }
interface GhIssue { number: number, title: string, body: string | null, html_url: string, state?: string, user?: GhUser, labels?: GhLabel[], pull_request?: { merged_at?: string | null } | null, updated_at?: string }
interface GhPull extends GhIssue { head?: { sha?: string }, base?: { ref?: string }, draft?: boolean }
type Note = (e: string | null | undefined) => void

export const NO_STUCK = { quiet: 0, draft: 0, epicSync: 0 }
/** The KV key holding when `teamId` last started a sync (ms since epoch). */
export const cardsSyncThrottleKey = (teamId: string) => `cards-sync:last:${teamId}`
/** A branch name as a URL path (keeps its `/`). */
const branchPath = (b: string) => b.split('/').map(encodeURIComponent).join('/')

const labelNames = (l: GhLabel[] = []) => l.map(x => x.name ?? '').filter(Boolean)

const comments = (gh: GhSource, n: number) => ghGetAll<GhComment>(gh, `/repos/${REPO}/issues/${n}/comments?per_page=100`)
const events = (gh: GhSource, n: number) => ghGetAll<GhEvent>(gh, `/repos/${REPO}/issues/${n}/events?per_page=100`)
const commits = (gh: GhSource, n: number) => ghGetAll<GhCommit>(gh, `/repos/${REPO}/pulls/${n}/commits?per_page=100`)
// A PR's files: GitHub lists up to 3000 (30 pages). Names the packages a review card warns about (#3785).
const files = (gh: GhSource, n: number) => ghGetAll<GhFile>(gh, `/repos/${REPO}/pulls/${n}/files?per_page=100`, 30)
/**
 * #4501: a delivery epic's newest merged `Epic #N:` PR into main, with its files and how many such
 * PRs were merged. The epic PR is already merged when `status:to-test` lands, so it is never in the
 * open-PR list. Search also hits titles that merely contain the number — keep exact-prefix titles only.
 */
async function readEpicPr(gh: GhSource, n: number) {
  const q = `repo:${REPO} is:pull-request base:main in:title "Epic #${n}:"`
  const s = await ghFetch<{ items?: GhIssue[] }>(gh, `/search/issues?q=${encodeURIComponent(q)}&per_page=100`, { fresh: true })
  if (s.error) return { data: null, error: s.error }
  const merged = (s.data?.items ?? [])
    .filter(p => p.title.startsWith(`Epic #${n}:`) && !!p.pull_request?.merged_at)
    .sort((a, b) => (a.pull_request!.merged_at! < b.pull_request!.merged_at! ? 1 : -1))
  const pr = merged[0]
  if (!pr) return { data: null, error: null }
  const f = await files(gh, pr.number)
  if (f.error) return { data: null, error: f.error }
  return { data: { number: pr.number, files: f.data ?? [], count: merged.length }, error: null }
}
const closedIssue = async (gh: GhSource, n: number | null | undefined) =>
  n ? ghFetch<GhIssue>(gh, `/repos/${REPO}/issues/${n}`, { fresh: true }) : { data: null, error: null }

/** Every list the sync reads. `complete` is false when any of them failed (then no card is staled). */
async function readLists(gh: GhSource, note: Note) {
  const [blocked, toTest, pulls, ...pipeline] = await Promise.all([
    ghFetch<GhIssue[]>(gh, `/repos/${REPO}/issues?labels=status:blocked&state=open&per_page=100`, { fresh: true }),
    ghFetch<GhIssue[]>(gh, `/repos/${REPO}/issues?labels=status:to-test&state=open&per_page=100`, { fresh: true }),
    ghGetAll<GhPull>(gh, `/repos/${REPO}/pulls?state=open&per_page=100`),
    // Stuck rule `quiet` (#3880): every open pipeline ticket, every page. Labels + updated_at only.
    ...PIPELINE_LABELS.map(l => ghGetAll<GhIssue>(gh, `/repos/${REPO}/issues?labels=${encodeURIComponent(l)}&state=open&per_page=100`))
  ])
  const since = new Date(Date.now() - QUIZ_DAYS * 86_400_000).toISOString().slice(0, 10)
  const q = `repo:${REPO} "Quick check" "reached main" in:comments updated:>=${since}`
  // Stuck rule `epic-sync` (#3880): open epics whose sync posted the conflict comment.
  const eq = `repo:${REPO} "${EPIC_SYNC_TEXT}" in:comments is:issue is:open label:epic`
  // GitHub refuses an untyped issue search (422, #4233): one typed search for issues, one for PRs.
  const [quizIssues, quizPulls, epicSearch] = await Promise.all([
    ghFetch<{ items?: GhIssue[] }>(gh, `/search/issues?q=${encodeURIComponent(`${q} is:issue`)}&per_page=100`, { fresh: true }),
    ghFetch<{ items?: GhIssue[] }>(gh, `/search/issues?q=${encodeURIComponent(`${q} is:pull-request`)}&per_page=100`, { fresh: true }),
    ghFetch<{ items?: GhIssue[] }>(gh, `/search/issues?q=${encodeURIComponent(eq)}&per_page=100`, { fresh: true })
  ])
  const all = [blocked, toTest, pulls, ...pipeline, quizIssues, quizPulls, epicSearch]
  for (const r of all) note(r.error)
  return {
    blocked: blocked.data ?? [], toTest: toTest.data ?? [], pulls: pulls.data ?? [],
    pipeline: pipeline.flatMap(r => r.data ?? []), quiz: [...(quizIssues.data?.items ?? []), ...(quizPulls.data?.items ?? [])], epics: epicSearch.data?.items ?? [],
    complete: all.every(r => !r.error)
  }
}

/** Open PR: comments for every one (the build-review state lives there); events + commits only for PRs a rule could claim. */
async function readPr(gh: GhSource, p: GhPull, note: Note): Promise<SyncItem> {
  const labels = labelNames(p.labels)
  const item: SyncItem = {
    number: p.number, isPr: true, title: p.title, html_url: p.html_url, labels, user: p.user, body: p.body,
    state: p.state, comments: [], events: [], commits: [], headSha: p.head?.sha, closesIssue: closesIssue(p.body),
    updatedAt: p.updated_at, draft: p.draft === true
  }
  const c = await comments(gh, p.number)
  if (c.error) { note(c.error); item.readError = true; return item }
  item.comments = c.data ?? []
  const signoff = isPipelineBot(p) && (p.body ?? '').includes(SIGNOFF_PREVIEW_MARKER)
  const reviewed = item.comments.some(x => isPipelineBot(x) && /<!-- build-review-/.test(x.body ?? ''))
  const held = labels.includes('status:needs-merge') || labels.includes('status:blocked')
  if (!(signoff || reviewed || held)) return item
  const [e, k, f, ci] = await Promise.all([
    events(gh, p.number), commits(gh, p.number), files(gh, p.number), closedIssue(gh, item.closesIssue)
  ])
  if (e.error || k.error || f.error || ci.error) {
    note(e.error); note(k.error); note(f.error); note(ci.error); item.readError = true; return item
  }
  item.events = e.data ?? []
  item.commits = k.data ?? []
  item.files = f.data ?? []
  item.closedIssueBody = ci.data?.body ?? null
  return item
}

const issueItem = (i: GhIssue): SyncItem => ({
  number: i.number, isPr: false, title: i.title, html_url: i.html_url, labels: labelNames(i.labels),
  user: i.user, body: i.body, state: i.state, comments: [], events: [], updatedAt: i.updated_at
})

/** Blocked / to-test issue: comments + events; a to-test epic also its merged epic PR (#4501). */
async function readIssue(gh: GhSource, i: GhIssue, note: Note): Promise<SyncItem> {
  const item = issueItem(i)
  const toTest = item.labels.includes('status:to-test')
  const [c, e, p] = await Promise.all([
    comments(gh, i.number), events(gh, i.number), toTest ? readEpicPr(gh, i.number) : Promise.resolve({ data: null, error: null })
  ])
  if (c.error || e.error || p.error) { note(c.error); note(e.error); note(p.error); item.readError = true; return item }
  item.comments = c.data ?? []
  item.events = e.data ?? []
  if (p.data) item.epicPr = p.data
  return item
}

/** Issues (not PRs) from `lists` not yet in `seen`, each once. Marks them seen. */
function newIssues(lists: GhIssue[], seen: Set<number>): GhIssue[] {
  const out: GhIssue[] = []
  for (const i of lists) {
    if (i.pull_request || seen.has(i.number)) continue
    seen.add(i.number)
    out.push(i)
  }
  return out
}

async function readQuiz(gh: GhSource, i: GhIssue, note: Note): Promise<QuizItem> {
  const c = await comments(gh, i.number)
  note(c.error)
  return { number: i.number, isPr: !!i.pull_request, title: i.title, html_url: i.html_url, comments: c.data ?? [], readError: !!c.error }
}

/**
 * Epic-sync: how far the epic branch is behind main's commit from the time of the conflict comment
 * (a sub-PR merge does not count; any merge of main does). A missing branch (404) → behindBy null.
 */
async function readEpic(gh: GhSource, i: GhIssue, note: Note): Promise<EpicSyncItem> {
  const item: EpicSyncItem = { number: i.number, title: i.title, html_url: i.html_url, comments: [], behindBy: 0 }
  const c = await comments(gh, i.number)
  if (c.error) { note(c.error); item.readError = true; return item }
  item.comments = c.data ?? []
  const hit = epicSyncComment(item.comments)
  const branch = hit ? epicSyncBranch(hit.body) : null
  if (!hit || !branch) return item
  const k = await ghFetch<Array<{ sha?: string }>>(gh, `/repos/${REPO}/commits?sha=main&until=${encodeURIComponent(hit.created_at)}&per_page=1`, { fresh: true })
  const sha = k.data?.[0]?.sha
  if (k.error || !sha) { note(k.error ?? `no main commit before ${hit.created_at}`); item.readError = true; return item }
  const cmp = await ghFetch<{ behind_by?: number }>(gh, `/repos/${REPO}/compare/${sha}...${branchPath(branch)}`, { fresh: true })
  if (cmp.error?.startsWith('GitHub 404')) item.behindBy = null
  else if (cmp.error || typeof cmp.data?.behind_by !== 'number') { note(cmp.error); item.readError = true }
  else item.behindBy = cmp.data.behind_by
  return item
}

/** For every waiting card whose ask is gone: its comments since askedAt (no entry when that read failed). */
async function readGone(gh: GhSource, cards: ExistingCard[], note: Note) {
  const gone: Record<string, { comments: GhComment[] }> = {}
  await Promise.all(cards.map(async (card) => {
    // An unreadable askedAt (#4253): no entry → the card is left alone, instead of a RangeError.
    const t = new Date(card.askedAt)
    if (Number.isNaN(t.getTime())) return
    const at = t.toISOString()
    const r = await ghGetAll<GhComment>(gh, `/repos/${REPO}/issues/${card.sourceNumber}/comments?since=${encodeURIComponent(at)}&per_page=100`)
    if (r.error) { note(r.error); return } // no entry → the card is left alone
    gone[cardKey(card)] = { comments: r.data ?? [] }
  }))
  return gone
}

/**
 * Which ticket each live chat claim covers (#4019): open `claimed`-labelled issues, their live
 * claim (`activeClaim`), then their sub-issues down to MAX_HOPS. Any failed read → null (each
 * card then keeps the claim it already shows).
 */
async function readClaims(gh: GhSource, note: Note): Promise<Record<number, CardClaim> | null> {
  const list = await ghGetAll<GhIssue>(gh, `/repos/${REPO}/issues?labels=claimed&state=open&per_page=100`)
  if (list.error) { note(list.error); return null }
  const issues = (list.data ?? []).filter(i => !i.pull_request)
  const reads = await Promise.all(issues.map(async i => ({ i, c: await comments(gh, i.number) })))
  const failed = reads.find(r => r.c.error)
  if (failed) { note(failed.c.error); return null }
  const live = reads
    .map(({ i, c }) => ({ issue: i.number, claim: activeClaim({ state: i.state, comments: c.data ?? [] }) }))
    .filter((x): x is { issue: number, claim: NonNullable<typeof x.claim> } => !!x.claim)
  const children: Record<number, number[]> = {}
  let frontier = live.map(x => x.issue)
  for (let hop = 0; hop < MAX_HOPS && frontier.length; hop++) {
    const todo = [...new Set(frontier)].filter(n => !(n in children))
    const subs = await Promise.all(todo.map(async n => ({ n, r: await ghGetAll<GhIssue>(gh, `/repos/${REPO}/issues/${n}/sub_issues?per_page=100`) })))
    const bad = subs.find(s => s.r.error)
    if (bad) { note(bad.r.error); return null }
    frontier = []
    for (const { n, r } of subs) {
      children[n] = (r.data ?? []).map(x => x.number)
      frontier.push(...children[n]!)
    }
  }
  return claimsByTicket({ live, children })
}

/** Read GitHub and collect every waiting ask. */
async function collectFromGitHub(gh: GhSource, note: Note): Promise<{
  asks: Ask[], unreadable: number[], complete: boolean, prTicket: Record<number, number | null | undefined>
  lists: Awaited<ReturnType<typeof readLists>>, prItems: SyncItem[]
}> {
  const lists = await readLists(gh, note)
  const prItems = await Promise.all(lists.pulls.map(p => readPr(gh, p, note)))
  const seen = new Set(prItems.map(i => i.number))
  const issueItems = await Promise.all(newIssues([...lists.blocked, ...lists.toTest], seen).map(i => readIssue(gh, i, note)))
  // Issues only in the pipeline-label lists: no comment/event reads (the quiet rule needs labels + updated_at).
  const quietItems = newIssues(lists.pipeline, seen).map(issueItem)
  const [quizItems, epicItems] = await Promise.all([
    Promise.all(lists.quiz.map(i => readQuiz(gh, i, note))),
    Promise.all(lists.epics.map(i => readEpic(gh, i, note)))
  ])
  const { asks, unreadable } = collectAsks({ items: [...prItems, ...issueItems, ...quietItems], quizItems, epicItems, now: Date.now() })
  const prTicket = Object.fromEntries(prItems.map(p => [p.number, p.closesIssue]))
  return { asks, unreadable, complete: lists.complete, prTicket, lists, prItems }
}

/**
 * Write the Pipeline board from the lists this sync read (#4349). Never throws: a failed read or
 * write is logged and lands in `errors`; the card counts are not touched.
 */
type Collected = Awaited<ReturnType<typeof collectFromGitHub>>

/** "Waits on you" at write time: this sync's asks (a PR ask counts for the issue it closes). */
function waitingIssues(asks: Ask[], prTicket: Collected['prTicket']): Set<number> {
  const waiting = new Set<number>()
  for (const a of asks) {
    const n = a.sourceType === 'pr' ? prTicket[a.sourceNumber] : a.sourceNumber
    if (n) waiting.add(n)
  }
  return waiting
}

/** The board plan from what this sync read, against the stored rows. */
function planBoard(collected: Collected, asks: Ask[], existing: BoardItem[]): BoardPlan {
  const { lists, prItems, prTicket, complete } = collected
  const base = new Map(lists.pulls.map(p => [p.number, p.base?.ref]))
  return boardFromLists({
    issues: [...lists.blocked, ...lists.toTest, ...lists.pipeline].map(i => ({
      number: i.number, title: i.title, html_url: i.html_url, labels: labelNames(i.labels), isPr: !!i.pull_request
    })),
    pulls: prItems.map(p => ({
      number: p.number, body: p.body, labels: p.labels, headSha: p.headSha, base: base.get(p.number), comments: p.comments, readError: p.readError
    })),
    existing,
    waiting: waitingIssues(asks, prTicket),
    complete
  })
}

/** Every write of `plan`, each tried on its own; returns the failures (what, error). Shared with the webhook writer (board-webhook.ts). */
export async function applyBoard(plan: BoardPlan, teamId: string, userId: string): Promise<unknown[]> {
  const writes: Array<() => Promise<unknown>> = [
    ...plan.create.map(c => () => createPipelineItem({ ...c, teamId, owner: userId, createdBy: userId, updatedBy: userId } as unknown as Parameters<typeof createPipelineItem>[0])),
    ...plan.update.map(u => () => updatePipelineItem(u.id, teamId, userId, u.patch as unknown as Parameters<typeof updatePipelineItem>[3], { role: 'owner' })),
    ...plan.remove.map(id => () => deletePipelineItem(id, teamId, userId, { role: 'owner' }))
  ]
  const failures: unknown[] = []
  for (const w of writes) {
    try { await w() } catch (e) {
      console.error('[cards-sync] board write failed', e)
      failures.push(e)
    }
  }
  return failures
}

async function writeBoard({ teamId, userId, collected, asks, errors }: {
  teamId: string, userId: string, collected: Collected, asks: Ask[], errors: string[]
}) {
  let existing: BoardItem[]
  try {
    existing = (await getAllPipelineItems(teamId)) as unknown as BoardItem[]
  } catch (e) {
    console.error('[cards-sync] board read failed', e)
    errors.push(`board read failed: ${message(e)}`)
    return
  }
  const failures = await applyBoard(planBoard(collected, asks, existing), teamId, userId)
  if (failures.length) errors.push(`${failures.length} board write(s) failed: ${message(failures[0])}`)
}

export interface CardsSyncOut {
  created: number
  updated: number
  stale: number
  answered: number
  stuck: { quiet: number, draft: number, epicSync: number }
  error?: string
  skipped?: number[]
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e)) || 'unknown error'

/**
 * One sync of `teamId`'s inbox, reading GitHub with `token`; cards are owned by `userId`. No throttle here.
 * Never throws (#4253): a failed card save is logged and counted while the others still run, and any
 * other throw (a D1 read, a JS error) answers zero counts — both land in `error`. Counts cover
 * successful saves only; a failed save is tried again by the next sync (the plan is rebuilt each time).
 */
export async function runCardsSync(args: { token: string | undefined, teamId: string, userId: string }): Promise<CardsSyncOut> {
  const errors: string[] = []
  try {
    return await syncOnce(args, errors)
  } catch (e) {
    console.error('[cards-sync]', e)
    return { created: 0, updated: 0, stale: 0, answered: 0, stuck: { ...NO_STUCK }, error: [...new Set([...errors, message(e)])].join('; ') }
  }
}

async function syncOnce({ token, teamId, userId }: { token: string | undefined, teamId: string, userId: string }, errors: string[]): Promise<CardsSyncOut> {
  const gh: GhSource = { token }
  const note: Note = (e) => { if (e) errors.push(e) }

  const [collected, byTicket] = await Promise.all([collectFromGitHub(gh, note), readClaims(gh, note)])
  const { unreadable, complete: listsComplete, prTicket } = collected
  const existing = (await getAllInboxCards(teamId)) as unknown as ExistingCard[]
  // Chat-claim badge (#4019): `payload.claim` on every ask whose ticket (or parent epic) is claimed.
  const asks = applyClaims(collected.asks, byTicket, existing, prTicket)
  const gone = await readGone(gh, goneCandidates({ asks, unreadable, existing, listsComplete }), note)

  const plan = planSync({ asks, unreadable, existing, gone, listsComplete })
  const counts = { ...plan.counts }
  let failed = 0
  let firstFailure = ''
  const saveFailed = (what: string, e: unknown) => {
    console.error('[cards-sync] save failed', what, e)
    if (!failed) firstFailure = message(e)
    failed++
  }
  for (const c of plan.create) {
    try {
      await createInboxCard({ ...c, teamId, owner: userId, createdBy: userId, updatedBy: userId } as unknown as Parameters<typeof createInboxCard>[0])
    } catch (e) {
      saveFailed(cardKey(c), e)
      counts.created--
    }
  }
  for (const u of plan.update) {
    try {
      await updateInboxCard(u.id, teamId, userId, u.patch as unknown as Parameters<typeof updateInboxCard>[3], { role: 'owner' })
    } catch (e) {
      saveFailed(u.id, e)
      if (u.patch.state === 'stale') counts.stale--
      else if (u.patch.state === 'answered') counts.answered--
      else counts.updated--
    }
  }
  if (failed) errors.push(`${failed} card save(s) failed: ${firstFailure}`)

  await writeBoard({ teamId, userId, collected, asks, errors })

  const out: CardsSyncOut = { ...counts, stuck: stuckCounts(asks) } as CardsSyncOut
  if (errors.length) out.error = [...new Set(errors)].join('; ')
  if (unreadable.length) out.skipped = unreadable
  return out
}
