// POST /api/cards/sync — read GitHub live and upsert one inbox card per ask that waits on the owner.
// → { created, updated, stale, answered, stuck: { quiet, draft, epicSync }, throttled?, error?, skipped? }
// Owner-only. Run by the inbox page on load (no cron: a cron has no session and no team). Skips the
// GitHub read when the last sync of this team was < 60 s ago. Rules: server/utils/cards-sync-core.ts.
// A failed GitHub read never changes a card: the item is skipped (listed in `skipped`) and the next
// sync tries again.
import type { H3Event } from 'h3'
import { createInboxCard, getAllInboxCards, updateInboxCard } from '../../../layers/inbox/collections/cards/server/database/queries'
import { resolveTeamAndCheckMembership } from '@fyit/crouton-auth/server/utils/team'
import { requireStatusOwner, ghFetch } from '../../utils/github'
import { ghGetAll } from '../../utils/gh-paged'
import {
  EPIC_SYNC_TEXT, PIPELINE_LABELS, SIGNOFF_PREVIEW_MARKER, cardKey, collectAsks, epicSyncBranch, epicSyncComment,
  goneCandidates, isPipelineBot, planSync, stuckCounts,
  type Ask, type EpicSyncItem, type ExistingCard, type GhComment, type GhCommit, type GhEvent, type GhUser, type QuizItem, type SyncItem
} from '../../utils/cards-sync-core'

const REPO = 'FriendlyInternet/nuxt-crouton'
const THROTTLE_MS = 60_000
const QUIZ_DAYS = 14

interface GhLabel { name?: string }
interface GhIssue { number: number, title: string, body: string | null, html_url: string, state?: string, user?: GhUser, labels?: GhLabel[], pull_request?: unknown, updated_at?: string }
interface GhPull extends GhIssue { head?: { sha?: string }, draft?: boolean }
type Note = (e: string | null | undefined) => void

const NO_STUCK = { quiet: 0, draft: 0, epicSync: 0 }
/** A branch name as a URL path (keeps its `/`). */
const branchPath = (b: string) => b.split('/').map(encodeURIComponent).join('/')

const labelNames = (l: GhLabel[] = []) => l.map(x => x.name ?? '').filter(Boolean)
const closesIssue = (body: string | null) => {
  const m = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#(\d+)/i.exec(body ?? '')
  return m ? Number(m[1]) : null
}

const comments = (event: H3Event, n: number) => ghGetAll<GhComment>(event, `/repos/${REPO}/issues/${n}/comments?per_page=100`)
const events = (event: H3Event, n: number) => ghGetAll<GhEvent>(event, `/repos/${REPO}/issues/${n}/events?per_page=100`)
const commits = (event: H3Event, n: number) => ghGetAll<GhCommit>(event, `/repos/${REPO}/pulls/${n}/commits?per_page=100`)

/** Every list the sync reads. `complete` is false when any of them failed (then no card is staled). */
async function readLists(event: H3Event, note: Note) {
  const [blocked, toTest, pulls, ...pipeline] = await Promise.all([
    ghFetch<GhIssue[]>(event, `/repos/${REPO}/issues?labels=status:blocked&state=open&per_page=100`, { fresh: true }),
    ghFetch<GhIssue[]>(event, `/repos/${REPO}/issues?labels=status:to-test&state=open&per_page=100`, { fresh: true }),
    ghGetAll<GhPull>(event, `/repos/${REPO}/pulls?state=open&per_page=100`),
    // Stuck rule `quiet` (#3880): every open pipeline ticket, every page. Labels + updated_at only.
    ...PIPELINE_LABELS.map(l => ghGetAll<GhIssue>(event, `/repos/${REPO}/issues?labels=${encodeURIComponent(l)}&state=open&per_page=100`))
  ])
  const since = new Date(Date.now() - QUIZ_DAYS * 86_400_000).toISOString().slice(0, 10)
  const q = `repo:${REPO} "Quick check" "reached main" in:comments updated:>=${since}`
  // Stuck rule `epic-sync` (#3880): open epics whose sync posted the conflict comment.
  const eq = `repo:${REPO} "${EPIC_SYNC_TEXT}" in:comments is:issue is:open label:epic`
  const [quiz, epicSearch] = await Promise.all([
    ghFetch<{ items?: GhIssue[] }>(event, `/search/issues?q=${encodeURIComponent(q)}&per_page=100`, { fresh: true }),
    ghFetch<{ items?: GhIssue[] }>(event, `/search/issues?q=${encodeURIComponent(eq)}&per_page=100`, { fresh: true })
  ])
  const all = [blocked, toTest, pulls, ...pipeline, quiz, epicSearch]
  for (const r of all) note(r.error)
  return {
    blocked: blocked.data ?? [], toTest: toTest.data ?? [], pulls: pulls.data ?? [],
    pipeline: pipeline.flatMap(r => r.data ?? []), quiz: quiz.data?.items ?? [], epics: epicSearch.data?.items ?? [],
    complete: all.every(r => !r.error)
  }
}

/** Open PR: comments for every one (the build-review state lives there); events + commits only for PRs a rule could claim. */
async function readPr(event: H3Event, p: GhPull, note: Note): Promise<SyncItem> {
  const labels = labelNames(p.labels)
  const item: SyncItem = {
    number: p.number, isPr: true, title: p.title, html_url: p.html_url, labels, user: p.user, body: p.body,
    state: p.state, comments: [], events: [], commits: [], headSha: p.head?.sha, closesIssue: closesIssue(p.body),
    updatedAt: p.updated_at, draft: p.draft === true
  }
  const c = await comments(event, p.number)
  if (c.error) { note(c.error); item.readError = true; return item }
  item.comments = c.data ?? []
  const signoff = isPipelineBot(p) && (p.body ?? '').includes(SIGNOFF_PREVIEW_MARKER)
  const reviewed = item.comments.some(x => isPipelineBot(x) && /<!-- build-review-/.test(x.body ?? ''))
  const held = labels.includes('status:needs-merge') || labels.includes('status:blocked')
  if (!(signoff || reviewed || held)) return item
  const [e, k] = await Promise.all([events(event, p.number), commits(event, p.number)])
  if (e.error || k.error) { note(e.error); note(k.error); item.readError = true; return item }
  item.events = e.data ?? []
  item.commits = k.data ?? []
  return item
}

const issueItem = (i: GhIssue): SyncItem => ({
  number: i.number, isPr: false, title: i.title, html_url: i.html_url, labels: labelNames(i.labels),
  user: i.user, body: i.body, state: i.state, comments: [], events: [], updatedAt: i.updated_at
})

/** Blocked / to-test issue: comments + events. */
async function readIssue(event: H3Event, i: GhIssue, note: Note): Promise<SyncItem> {
  const item = issueItem(i)
  const [c, e] = await Promise.all([comments(event, i.number), events(event, i.number)])
  if (c.error || e.error) { note(c.error); note(e.error); item.readError = true; return item }
  item.comments = c.data ?? []
  item.events = e.data ?? []
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

async function readQuiz(event: H3Event, i: GhIssue, note: Note): Promise<QuizItem> {
  const c = await comments(event, i.number)
  note(c.error)
  return { number: i.number, isPr: !!i.pull_request, title: i.title, html_url: i.html_url, comments: c.data ?? [], readError: !!c.error }
}

/**
 * Epic-sync: how far the epic branch is behind main's commit from the time of the conflict comment
 * (a sub-PR merge does not count; any merge of main does). A missing branch (404) → behindBy null.
 */
async function readEpic(event: H3Event, i: GhIssue, note: Note): Promise<EpicSyncItem> {
  const item: EpicSyncItem = { number: i.number, title: i.title, html_url: i.html_url, comments: [], behindBy: 0 }
  const c = await comments(event, i.number)
  if (c.error) { note(c.error); item.readError = true; return item }
  item.comments = c.data ?? []
  const hit = epicSyncComment(item.comments)
  const branch = hit ? epicSyncBranch(hit.body) : null
  if (!hit || !branch) return item
  const k = await ghFetch<Array<{ sha?: string }>>(event, `/repos/${REPO}/commits?sha=main&until=${encodeURIComponent(hit.created_at)}&per_page=1`, { fresh: true })
  const sha = k.data?.[0]?.sha
  if (k.error || !sha) { note(k.error ?? `no main commit before ${hit.created_at}`); item.readError = true; return item }
  const cmp = await ghFetch<{ behind_by?: number }>(event, `/repos/${REPO}/compare/${sha}...${branchPath(branch)}`, { fresh: true })
  if (cmp.error?.startsWith('GitHub 404')) item.behindBy = null
  else if (cmp.error || typeof cmp.data?.behind_by !== 'number') { note(cmp.error); item.readError = true }
  else item.behindBy = cmp.data.behind_by
  return item
}

/** For every waiting card whose ask is gone: its comments since askedAt (no entry when that read failed). */
async function readGone(event: H3Event, cards: ExistingCard[], note: Note) {
  const gone: Record<string, { comments: GhComment[] }> = {}
  await Promise.all(cards.map(async (card) => {
    const at = new Date(card.askedAt).toISOString()
    const r = await ghGetAll<GhComment>(event, `/repos/${REPO}/issues/${card.sourceNumber}/comments?since=${encodeURIComponent(at)}&per_page=100`)
    if (r.error) { note(r.error); return } // no entry → the card is left alone
    gone[cardKey(card)] = { comments: r.data ?? [] }
  }))
  return gone
}

/** Read GitHub and collect every waiting ask. */
async function collectFromGitHub(event: H3Event, note: Note): Promise<{ asks: Ask[], unreadable: number[], complete: boolean }> {
  const lists = await readLists(event, note)
  const prItems = await Promise.all(lists.pulls.map(p => readPr(event, p, note)))
  const seen = new Set(prItems.map(i => i.number))
  const issueItems = await Promise.all(newIssues([...lists.blocked, ...lists.toTest], seen).map(i => readIssue(event, i, note)))
  // Issues only in the pipeline-label lists: no comment/event reads (the quiet rule needs labels + updated_at).
  const quietItems = newIssues(lists.pipeline, seen).map(issueItem)
  const [quizItems, epicItems] = await Promise.all([
    Promise.all(lists.quiz.map(i => readQuiz(event, i, note))),
    Promise.all(lists.epics.map(i => readEpic(event, i, note)))
  ])
  const { asks, unreadable } = collectAsks({ items: [...prItems, ...issueItems, ...quietItems], quizItems, epicItems, now: Date.now() })
  return { asks, unreadable, complete: lists.complete }
}

export default defineEventHandler(async (event) => {
  await requireStatusOwner(event)
  const { team, user } = await resolveTeamAndCheckMembership(event)

  const store = useStorage('kv')
  const throttleKey = `cards-sync:last:${team.id}`
  const last = Number(await store.getItem(throttleKey)) || 0
  if (Date.now() - last < THROTTLE_MS) return { created: 0, updated: 0, stale: 0, answered: 0, stuck: { ...NO_STUCK }, throttled: true }
  await store.setItem(throttleKey, Date.now())

  const errors: string[] = []
  const note: Note = (e) => { if (e) errors.push(e) }

  const { asks, unreadable, complete: listsComplete } = await collectFromGitHub(event, note)
  const existing = (await getAllInboxCards(team.id)) as unknown as ExistingCard[]
  const gone = await readGone(event, goneCandidates({ asks, unreadable, existing, listsComplete }), note)

  const plan = planSync({ asks, unreadable, existing, gone, listsComplete })
  for (const c of plan.create) {
    await createInboxCard({ ...c, teamId: team.id, owner: user.id, createdBy: user.id, updatedBy: user.id } as unknown as Parameters<typeof createInboxCard>[0])
  }
  for (const u of plan.update) {
    await updateInboxCard(u.id, team.id, user.id, u.patch as unknown as Parameters<typeof updateInboxCard>[3], { role: 'owner' })
  }

  const out: Record<string, unknown> = { ...plan.counts, stuck: stuckCounts(asks) }
  if (errors.length) out.error = [...new Set(errors)].join('; ')
  if (unreadable.length) out.skipped = unreadable
  return out
})
