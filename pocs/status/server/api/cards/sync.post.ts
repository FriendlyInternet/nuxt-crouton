// POST /api/cards/sync — read GitHub live and upsert one inbox card per ask that waits on the owner.
// → { created, updated, stale, answered, throttled?, error?, skipped? }
// Owner-only. Run by the inbox page on load (no cron: a cron has no session and no team). Skips the
// GitHub read when the last sync of this team was < 60 s ago. Rules: server/utils/cards-sync-core.ts.
// A failed GitHub read never changes a card: the item is skipped (listed in `skipped`) and the next
// sync tries again.
import { createInboxCard, getAllInboxCards, updateInboxCard } from '../../../layers/inbox/collections/cards/server/database/queries'
import { resolveTeamAndCheckMembership } from '@fyit/crouton-auth/server/utils/team'
import { requireStatusOwner, ghFetch } from '../../utils/github'
import { ghGetAll } from '../../utils/gh-paged'
import {
  SIGNOFF_PREVIEW_MARKER, cardKey, collectAsks, goneCandidates, isPipelineBot, planSync,
  type ExistingCard, type GhComment, type GhCommit, type GhEvent, type GhUser, type QuizItem, type SyncItem
} from '../../utils/cards-sync-core'

const REPO = 'FriendlyInternet/nuxt-crouton'
const THROTTLE_MS = 60_000
const QUIZ_DAYS = 14

interface GhLabel { name?: string }
interface GhIssue { number: number, title: string, body: string | null, html_url: string, state?: string, user?: GhUser, labels?: GhLabel[], pull_request?: unknown }
interface GhPull extends GhIssue { head?: { sha?: string } }

const labelNames = (l: GhLabel[] = []) => l.map(x => x.name ?? '').filter(Boolean)
const closesIssue = (body: string | null) => {
  const m = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#(\d+)/i.exec(body ?? '')
  return m ? Number(m[1]) : null
}

export default defineEventHandler(async (event) => {
  await requireStatusOwner(event)
  const { team, user } = await resolveTeamAndCheckMembership(event)

  const store = useStorage('kv')
  const throttleKey = `cards-sync:last:${team.id}`
  const last = Number(await store.getItem(throttleKey)) || 0
  if (Date.now() - last < THROTTLE_MS) return { created: 0, updated: 0, stale: 0, answered: 0, throttled: true }
  await store.setItem(throttleKey, Date.now())

  const errors: string[] = []
  const note = (e: string | null) => { if (e) errors.push(e) }

  const [blocked, toTest, pulls] = await Promise.all([
    ghFetch<GhIssue[]>(event, `/repos/${REPO}/issues?labels=status:blocked&state=open&per_page=100`, { fresh: true }),
    ghFetch<GhIssue[]>(event, `/repos/${REPO}/issues?labels=status:to-test&state=open&per_page=100`, { fresh: true }),
    ghFetch<GhPull[]>(event, `/repos/${REPO}/pulls?state=open&per_page=100`, { fresh: true })
  ])
  note(blocked.error); note(toTest.error); note(pulls.error)

  const since = new Date(Date.now() - QUIZ_DAYS * 86_400_000).toISOString().slice(0, 10)
  const q = `repo:${REPO} "Quick check" "reached main" in:comments updated:>=${since}`
  const quiz = await ghFetch<{ items?: GhIssue[] }>(event, `/search/issues?q=${encodeURIComponent(q)}&per_page=100`, { fresh: true })
  note(quiz.error)
  const listsComplete = !blocked.error && !toTest.error && !pulls.error && !quiz.error

  const comments = (n: number) => ghGetAll<GhComment>(event, `/repos/${REPO}/issues/${n}/comments?per_page=100`)
  const events = (n: number) => ghGetAll<GhEvent>(event, `/repos/${REPO}/issues/${n}/events?per_page=100`)
  const commits = (n: number) => ghGetAll<GhCommit>(event, `/repos/${REPO}/pulls/${n}/commits?per_page=100`)

  // Open PRs: comments for every one (the build-review state lives there); events + commits only
  // for PRs a rule could claim.
  const prItems = await Promise.all((pulls.data ?? []).map(async (p): Promise<SyncItem> => {
    const labels = labelNames(p.labels)
    const item: SyncItem = {
      number: p.number, isPr: true, title: p.title, html_url: p.html_url, labels, user: p.user, body: p.body,
      state: p.state, comments: [], events: [], commits: [], headSha: p.head?.sha, closesIssue: closesIssue(p.body)
    }
    const c = await comments(p.number)
    if (c.error) { note(c.error); item.readError = true; return item }
    item.comments = c.data ?? []
    const signoff = isPipelineBot(p) && (p.body ?? '').includes(SIGNOFF_PREVIEW_MARKER)
    const reviewed = item.comments.some(x => isPipelineBot(x) && /<!-- build-review-/.test(x.body ?? ''))
    if (!(signoff || reviewed || labels.includes('status:needs-merge') || labels.includes('status:blocked'))) return item
    const [e, k] = await Promise.all([events(p.number), commits(p.number)])
    if (e.error || k.error) { note(e.error); note(k.error); item.readError = true; return item }
    item.events = e.data ?? []
    item.commits = k.data ?? []
    return item
  }))

  // Open issues (not PRs) that are blocked or waiting to be tried.
  const seen = new Set(prItems.map(i => i.number))
  const issues: GhIssue[] = []
  for (const i of [...(blocked.data ?? []), ...(toTest.data ?? [])]) {
    if (i.pull_request || seen.has(i.number)) continue
    seen.add(i.number)
    issues.push(i)
  }
  const issueItems = await Promise.all(issues.map(async (i): Promise<SyncItem> => {
    const item: SyncItem = { number: i.number, isPr: false, title: i.title, html_url: i.html_url, labels: labelNames(i.labels), user: i.user, body: i.body, state: i.state, comments: [], events: [] }
    const [c, e] = await Promise.all([comments(i.number), events(i.number)])
    if (c.error || e.error) { note(c.error); note(e.error); item.readError = true; return item }
    item.comments = c.data ?? []
    item.events = e.data ?? []
    return item
  }))

  const quizItems = await Promise.all((quiz.data?.items ?? []).map(async (i): Promise<QuizItem> => {
    const c = await comments(i.number)
    if (c.error) note(c.error)
    return { number: i.number, isPr: !!i.pull_request, title: i.title, html_url: i.html_url, comments: c.data ?? [], readError: !!c.error }
  }))

  const { asks, unreadable } = collectAsks({ items: [...prItems, ...issueItems], quizItems })
  const existing = (await getAllInboxCards(team.id)) as unknown as ExistingCard[]

  const gone: Record<string, { comments: GhComment[] }> = {}
  await Promise.all(goneCandidates({ asks, unreadable, existing, listsComplete }).map(async (card) => {
    const at = new Date(card.askedAt).toISOString()
    const r = await ghGetAll<GhComment>(event, `/repos/${REPO}/issues/${card.sourceNumber}/comments?since=${encodeURIComponent(at)}&per_page=100`)
    if (r.error) { note(r.error); return } // no entry → the card is left alone
    gone[cardKey(card)] = { comments: r.data ?? [] }
  }))

  const plan = planSync({ asks, unreadable, existing, gone, listsComplete })
  for (const c of plan.create) {
    await createInboxCard({ ...c, teamId: team.id, owner: user.id, createdBy: user.id, updatedBy: user.id } as unknown as Parameters<typeof createInboxCard>[0])
  }
  for (const u of plan.update) {
    await updateInboxCard(u.id, team.id, user.id, u.patch as unknown as Parameters<typeof updateInboxCard>[3], { role: 'owner' })
  }

  const out: Record<string, unknown> = { ...plan.counts }
  if (errors.length) out.error = [...new Set(errors)].join('; ')
  if (unreadable.length) out.skipped = unreadable
  return out
})
