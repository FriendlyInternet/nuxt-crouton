// Pure classifier for the Now / Next / Waiting view — no Nitro auto-imports, so it unit-tests.
// Input is raw GitHub payloads; output is the three lists. No state of its own.
// "Waiting for owner" for a PR comes from the pipeline's own gate (decideReview), not a rule re-worked here.
import { decideReview } from '../../../../scripts/lib/pr-merge-gate.mjs'
import { reviewState } from '../../../../scripts/lib/build-review-state.mjs'
import { ownerMergeGo } from '../../../../scripts/lib/owner-merge-go.mjs'

// The gate modules infer narrow JSDoc types; this app feeds them raw GitHub payloads.
/* eslint-disable @typescript-eslint/no-explicit-any */
const reviewStateAny = reviewState as (a: any) => any
const ownerMergeGoAny = ownerMergeGo as (a: any) => any
const decideReviewAny = decideReview as (a: any) => { merge: boolean }

export const OWNER_LOGIN = 'pmcp'
export interface GhLabel { name?: string }
export interface GhPr {
  number: number, title: string, html_url: string, draft?: boolean, body?: string | null
  head?: { ref?: string, sha?: string }, base?: { ref?: string }, labels?: GhLabel[], user?: { login?: string, type?: string }
}
export interface GhIssueLite { number: number, title: string, html_url: string, body?: string | null, labels?: GhLabel[], pull_request?: unknown }
export interface GhRun { name?: string, display_title?: string, status?: string, html_url?: string }
export interface GhComment { body?: string | null, created_at?: string, user?: { login?: string, type?: string } }

export interface NowItem { number: number, kind: 'pr' | 'issue', title: string, url: string, step: string }
export interface NextItem { number: number, title: string, url: string, epic: number | null }
export interface WaitingItem { number: number, kind: 'pr' | 'issue', title: string, url: string, reason: string }
export interface NowResult { now: NowItem[], next: NextItem[], waiting: WaitingItem[] }

export interface NowInput {
  pulls: GhPr[]
  workIssues: GhIssueLite[]
  /** Open issues labelled plan:approved (plan signed off, waiting to be built). */
  approvedIssues?: GhIssueLite[]
  blockedIssues: GhIssueLite[]
  runs: GhRun[]
  /** Comment bodies (oldest first) keyed by issue/PR number — only fetched for held candidates. */
  comments: Record<number, GhComment[]>
}

const hasLabel = (x: { labels?: GhLabel[] }, name: string) => (x.labels ?? []).some(l => l.name === name)
const isPipelinePr = (p: GhPr) => {
  const ref = p.head?.ref ?? ''
  const bot = p.user?.type === 'Bot' || /\[bot\]$|^nuxt-harness$/.test(p.user?.login ?? '')
  return bot && (ref.startsWith('work-') || ref.startsWith('epic/'))
}

/** Does the pipeline's gate say this PR waits for the owner (final / needs-owner review hold, owner not yet ok)? */
function waitsForOwner(p: GhPr, comments: GhComment[]): boolean {
  const bots = [...new Set(comments.filter(c => c.user?.type === 'Bot').map(c => c.user?.login))]
  const headSha = p.head?.sha ?? ''
  const state = reviewStateAny({ comments, headSha, bots })
  const ownerHold = state.kind === 'final' || state.kind === 'needs-owner' ? state : null
  if (!ownerHold) return false
  const go = ownerMergeGoAny({ comments, commits: [], owner: OWNER_LOGIN })
  const labels = (p.labels ?? []).map(l => l.name ?? '')
  return !decideReviewAny({ baseRef: p.base?.ref ?? 'main', headRef: p.head?.ref ?? '', labels, go, ownerHold, headSha, headReview: state }).merge
}
const epicOf = (i: GhIssueLite) => { const m = /\bepic=(\d+)/.exec(i.body ?? ''); return m ? Number(m[1]) : null }

/** One-line reason from a hold comment: the "## … Blocked — X" heading, else the first prose line. */
export function holdReason(body: string | null | undefined): string {
  const lines = String(body ?? '').split(/\r?\n/).map(l => l.trim())
  const heading = lines.find(l => /^#{1,6}\s+.*blocked/i.test(l))
  if (heading) return heading.replace(/^#{1,6}\s+/, '').replace(/^\S*\s*Blocked\s*[—–:-]\s*/i, '').trim()
  const prose = lines.find(l => l && !l.startsWith('>') && !l.startsWith('<') && !l.startsWith('**Needs'))
  return (prose ?? '').replace(/^#{1,6}\s+/, '').slice(0, 200)
}

/** Issue numbers a PR works on: "Closes #N" in the body, or `work-N…` in the head ref. */
function linkedIssues(p: GhPr): number[] {
  const out = new Set<number>()
  for (const m of String(p.body ?? '').matchAll(/\b(?:closes|fixes|resolves)\s+#(\d+)/gi)) out.add(Number(m[1]))
  const h = /^work-(?:issue-)?(\d+)/.exec(p.head?.ref ?? '')
  if (h) out.add(Number(h[1]))
  return [...out]
}

// fallow-ignore-next-line complexity -- one linear pass assembling now/next/waiting; splitting scatters the shared sets
export function classifyNow(input: NowInput): NowResult {
  const latest = (n: number) => (input.comments[n] ?? []).at(-1)?.body ?? ''
  const waiting: WaitingItem[] = []
  const heldNumbers = new Set<number>()

  for (const i of input.blockedIssues.filter(x => !x.pull_request)) {
    heldNumbers.add(i.number)
    waiting.push({ number: i.number, kind: 'issue', title: i.title, url: i.html_url, reason: holdReason(latest(i.number)) || 'Blocked' })
  }
  const blockedReason = new Map(waiting.map(w => [w.number, w.reason]))
  for (const p of input.pulls.filter(x => !x.draft)) {
    const verdict = latest(p.number)
    const blockedTicket = linkedIssues(p).find(n => blockedReason.has(n))
    if (hasLabel(p, 'status:blocked') || blockedTicket !== undefined || waitsForOwner(p, input.comments[p.number] ?? [])) {
      heldNumbers.add(p.number)
      const reason = holdReason(verdict) || (blockedTicket !== undefined ? blockedReason.get(blockedTicket) : '') || 'Held for you'
      waiting.push({ number: p.number, kind: 'pr', title: p.title, url: p.html_url, reason })
    }
  }

  const now: NowItem[] = []
  const active = new Set<number>()
  for (const r of input.runs) {
    const n = Number(/#(\d+)/.exec(r.display_title ?? r.name ?? '')?.[1])
    if (!n || active.has(n)) continue
    active.add(n)
    const mode = /·\s*(\w+)/.exec(r.display_title ?? r.name ?? '')?.[1] ?? 'build'
    now.push({ number: n, kind: 'issue', title: r.display_title ?? r.name ?? `#${n}`, url: r.html_url ?? '', step: /review/i.test(r.name ?? '') ? 'In review' : mode === 'plan' ? 'Planning' : 'Building' })
  }
  const withPr = new Set<number>()
  for (const p of input.pulls.filter(isPipelinePr)) {
    for (const n of linkedIssues(p)) withPr.add(n)
    if (heldNumbers.has(p.number)) continue
    now.push({ number: p.number, kind: 'pr', title: p.title, url: p.html_url, step: p.draft ? 'Draft — in a fix round' : 'In review / CI' })
  }

  const next = [...input.workIssues, ...(input.approvedIssues ?? [])]
    .filter((i, idx, all) => all.findIndex(x => x.number === i.number) === idx)
    .filter(i => !i.pull_request && !hasLabel(i, 'status:blocked') && !heldNumbers.has(i.number) && !withPr.has(i.number) && !active.has(i.number))
    .map(i => ({ number: i.number, title: i.title, url: i.html_url, epic: epicOf(i) }))
    .sort((a, b) => (a.epic ?? Infinity) - (b.epic ?? Infinity) || a.number - b.number)

  return { now: now.filter(n => !(n.kind === 'issue' && heldNumbers.has(n.number))), next, waiting }
}
