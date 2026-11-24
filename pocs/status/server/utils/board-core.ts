// Pure core of the Pipeline board (#4349): which column a ticket is in (`stageOf`), what the card sync
// writes to `pipeline_items` (`boardFromLists`), and what GET /api/status/board shows (`boardView`).
// No Nitro auto-imports, so it unit-tests. Rule: a ticket is in at most one column, worked out only by
// `stageOf`; nothing here writes to GitHub.
import { isPipelineBot, markerValue, BUILD_REVIEW_FAILED_RE, BUILD_REVIEW_SHA_RE, BUILD_REVIEW_VERDICT_RE, WAITING_LABEL, type GhComment } from './cards-sync-core'

export type Stage = 'queued' | 'working' | 'review' | 'you' | 'test' | 'done'
export const DONE_MS = 24 * 3_600_000
/** Labels that mean the pipeline is building/planning the ticket (rule 7). */
export const WORKING_LABELS = ['work-this', 'delegate', 'delegate-pi', 'plan:approved']

type When = Date | string | number | null | undefined

/** One `pipeline_items` row (the fields the board reads/writes). */
export interface BoardItem {
  id?: string
  number: number
  title?: string | null
  url?: string | null
  stage?: string | null
  labels?: string | null
  prLabels?: string | null
  prNumber?: number | null
  prHeadSha?: string | null
  prBase?: string | null
  verdict?: string | null
  verdictSha?: string | null
  checksRed?: boolean | null
  checksSha?: string | null
  closedAt?: When
  stageSince?: When
  order?: number | null
}

/** The number a PR body closes (`Closes #N`, also fixes/resolves), or null. */
export const closesIssue = (body: string | null | undefined) => {
  const m = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#(\d+)/i.exec(body ?? '')
  return m ? Number(m[1]) : null
}

const ms = (t: When) => {
  if (t === null || t === undefined || t === '') return null
  const n = t instanceof Date ? t.getTime() : typeof t === 'number' ? t : Date.parse(t)
  return Number.isNaN(n) ? null : n
}
const split = (s: string | null | undefined) => String(s ?? '').split(',').map(x => x.trim()).filter(Boolean)
const join = (l: string[]) => l.join(',')
const hasPr = (item: BoardItem) => item.prNumber !== null && item.prNumber !== undefined

/** The item's labels: issue labels ∪ PR labels. */
export const itemLabels = (item: BoardItem) => new Set([...split(item.labels), ...split(item.prLabels)])

/**
 * The column of `item`, or null (not on the board). `waiting` = issue numbers with a waiting inbox card
 * on the issue or its PR. First match wins (the order is the rule, #4349).
 */
export function stageOf(item: BoardItem, waiting: Set<number>, now: number = Date.now()): Stage | null {
  const closed = ms(item.closedAt)
  if (closed !== null) return now - closed <= DONE_MS ? 'done' : null
  const labels = itemLabels(item)
  if (labels.has(WAITING_LABEL)) return 'queued'
  if (labels.has('status:to-test')) return 'test'
  if (labels.has('epic')) return null
  if (waiting.has(item.number)) return 'you'
  const prOpen = hasPr(item)
  const noGoOnHead = prOpen && !!item.prHeadSha && item.verdictSha === item.prHeadSha && item.verdict === 'no-go'
  if (prOpen && !noGoOnHead) return 'review'
  if (noGoOnHead || WORKING_LABELS.some(l => labels.has(l))) return 'working'
  return null
}

interface Verdict { verdict: string | null, verdictSha: string | null }
const NO_VERDICT: Verdict = { verdict: null, verdictSha: null }

/** One bot comment's build-review verdict + sha, or null when it carries none. */
function commentVerdict(c: GhComment): Verdict & { at: number } | null {
  if (!isPipelineBot(c)) return null
  const body = c.body ?? ''
  const sha = BUILD_REVIEW_SHA_RE.exec(body)?.[1]
  if (sha) return { verdict: markerValue(body, BUILD_REVIEW_VERDICT_RE) ?? 'other', verdictSha: sha, at: ms(c.created_at) ?? 0 }
  const failed = BUILD_REVIEW_FAILED_RE.exec(body)?.[1]
  return failed ? { verdict: 'failed', verdictSha: failed, at: ms(c.created_at) ?? 0 } : null
}

/** The newest pipeline-bot build-review comment's verdict and sha. Other accounts never count. */
export function latestVerdict(comments: GhComment[] = []): Verdict {
  let best: (Verdict & { at: number }) | null = null
  for (const c of comments) {
    const v = commentVerdict(c)
    if (v && (!best || v.at >= best.at)) best = v
  }
  return best ? { verdict: best.verdict, verdictSha: best.verdictSha } : NO_VERDICT
}

// ---------------------------------------------------------------- the card sync's writer

export interface BoardIssue { number: number, title: string, html_url: string, labels: string[], isPr?: boolean }
export interface BoardPull { number: number, body?: string | null, labels: string[], headSha?: string, base?: string, comments: GhComment[], readError?: boolean }
export interface BoardPlan {
  create: BoardItem[]
  update: Array<{ id: string, patch: Partial<BoardItem> }>
  remove: string[]
}

const PR_CLEARED: Partial<BoardItem> = {
  prNumber: null, prHeadSha: null, prBase: null, prLabels: null, verdict: null, verdictSha: null, checksRed: false, checksSha: null
}
const FIELDS: Array<keyof BoardItem> = ['title', 'url', 'stage', 'labels', 'prLabels', 'prNumber', 'prHeadSha', 'prBase', 'verdict', 'verdictSha', 'checksRed', 'checksSha', 'closedAt', 'stageSince', 'order']
const same = (a: unknown, b: unknown) => {
  if (a instanceof Date || b instanceof Date) return ms(a as When) === ms(b as When)
  return (a ?? null) === (b ?? null)
}

/** Sets stage/stageSince/order on `next` (stageSince moves only when the stage changes). */
function withStage(next: BoardItem, prev: BoardItem | undefined, stage: Stage | null, now: number): BoardItem {
  const kept = prev && prev.stage === stage ? ms(prev.stageSince) : null
  if (kept !== null) return { ...next, stage, stageSince: prev!.stageSince, order: prev!.order ?? kept }
  return { ...next, stage, stageSince: new Date(now), order: now }
}

function patchOf(prev: BoardItem, next: BoardItem): Partial<BoardItem> {
  const changed = FIELDS.filter(k => !same(prev[k], next[k]))
  return Object.fromEntries(changed.map(k => [k, next[k] ?? null])) as Partial<BoardItem>
}

/** Issue number → its newest open PR, for PRs closing an issue that is listed or already has a row. */
function prsByIssue(pulls: BoardPull[], known: (n: number) => boolean): Map<number, BoardPull> {
  const out = new Map<number, BoardPull>()
  for (const p of pulls) {
    const n = closesIssue(p.body)
    if (n === null || !known(n)) continue
    const had = out.get(n)
    if (!had || p.number > had.number) out.set(n, p)
  }
  return out
}

/** The PR's fields on the row; a failed comments read keeps the stored verdict; a new head clears checksRed. */
function withPr(next: BoardItem, prev: BoardItem | undefined, pr: BoardPull): BoardItem {
  const verdict = pr.readError ? { verdict: next.verdict ?? null, verdictSha: next.verdictSha ?? null } : latestVerdict(pr.comments)
  const out: BoardItem = { ...next, prNumber: pr.number, prHeadSha: pr.headSha ?? null, prBase: pr.base ?? null, prLabels: join(pr.labels), ...verdict, closedAt: null }
  if (prev?.prHeadSha !== pr.headSha) out.checksRed = false
  return out
}

/** The row as the lists show it now (before its stage). */
function nextRow(n: number, prev: BoardItem | undefined, issue: BoardIssue | undefined, pr: BoardPull | undefined, complete: boolean): BoardItem {
  let next: BoardItem = { ...(prev ?? { number: n, checksRed: false }) }
  if (issue) next = { ...next, title: issue.title, url: issue.html_url, labels: join(issue.labels), closedAt: null }
  if (pr) return withPr(next, prev, pr)
  return complete && prev && hasPr(prev) ? { ...next, ...PR_CLEARED } : next
}

/** Adds the create/update for one row to `plan` (nothing when unchanged). */
function record(plan: BoardPlan, prev: BoardItem | undefined, next: BoardItem) {
  if (!prev) { plan.create.push(next); return }
  const patch = patchOf(prev, next)
  if (Object.keys(patch).length) plan.update.push({ id: prev.id!, patch })
}

/** Complete lists only: a row missing from them is closed now, or deleted when closed > 24 h ago. */
function sweepMissing(plan: BoardPlan, prev: BoardItem, waiting: Set<number>, now: number) {
  const closed = ms(prev.closedAt)
  if (closed !== null) {
    if (now - closed > DONE_MS) plan.remove.push(prev.id!)
    return
  }
  let next: BoardItem = { ...prev, closedAt: new Date(now) }
  if (hasPr(prev)) next = { ...next, ...PR_CLEARED }
  next = withStage(next, prev, stageOf(next, waiting, now), now)
  plan.update.push({ id: prev.id!, patch: patchOf(prev, next) })
}

/**
 * What the card sync writes to the board, from the lists it already read (no extra GitHub reads).
 * One row per issue; a PR folds into the issue its body closes, when that issue is in the lists or
 * already has a row (a PR closing nothing, or a non-pipeline issue, is skipped). A new row is written
 * only when `stageOf` gives a column. Only when every list read succeeded (`complete`): a row missing
 * from the lists gets `closedAt = now`, a row whose PR is no longer open gets its PR fields cleared,
 * and rows closed > 24 h ago are deleted. A PR whose comments failed to read keeps its stored verdict.
 */
export function boardFromLists({ issues, pulls, existing, waiting, complete, now = Date.now() }: {
  issues: BoardIssue[]
  pulls: BoardPull[]
  existing: BoardItem[]
  waiting: Set<number>
  complete: boolean
  now?: number
}): BoardPlan {
  const plan: BoardPlan = { create: [], update: [], remove: [] }
  const rows = firstBy(existing)
  const open = firstBy(issues.filter(i => !i.isPr))
  const prFor = prsByIssue(pulls, n => open.has(n) || rows.has(n))

  const seen = new Set<number>([...open.keys(), ...prFor.keys()])
  for (const n of seen) {
    const prev = rows.get(n)
    planRow(plan, prev, nextRow(n, prev, open.get(n), prFor.get(n), complete), waiting, now)
  }

  if (!complete) return plan
  for (const prev of rows.values()) {
    if (!seen.has(prev.number) && prev.id) sweepMissing(plan, prev, waiting, now)
  }
  return plan
}

/** Number → the first entry with that number. */
function firstBy<T extends { number: number }>(list: T[]): Map<number, T> {
  const out = new Map<number, T>()
  for (const x of list) if (!out.has(x.number)) out.set(x.number, x)
  return out
}

/**
 * One listed row: an epic never gets a new row, but an existing row still takes its new labels (so
 * `stageOf` drops it off the board); a new row only when it has a column.
 */
function planRow(plan: BoardPlan, prev: BoardItem | undefined, next: BoardItem, waiting: Set<number>, now: number) {
  if (!prev && itemLabels(next).has('epic')) return
  const stage = stageOf(next, waiting, now)
  if (prev || stage) record(plan, prev, withStage(next, prev, stage, now))
}

// ---------------------------------------------------------------- the webhook's writer (#4350)

/**
 * One webhook event, as the board needs it (built by `boardEventOf` in webhook-core.ts from the
 * payload alone — the webhook never calls GitHub):
 * - `issue`: an `issues` event, or an `issue_comment` on a plain issue (its payload carries the issue);
 * - `pr`: a `pull_request` or `pull_request_review` event (the payload's PR: body, labels, head, base);
 * - `comment`: an `issue_comment` on a PR (may carry a build-review verdict);
 * - `checks`: a completed `workflow_run` of the `CI` workflow.
 */
export type BoardEvent =
  | { kind: 'issue', number: number, title: string, url: string, labels: string[], closedAt: string | null }
  | { kind: 'pr', number: number, body: string | null, labels: string[], headSha: string | null, base: string | null, closed: boolean }
  | { kind: 'comment', prNumber: number, comment: GhComment }
  | { kind: 'checks', headSha: string, prNumbers: number[], conclusion: string }

/** The issue row of an issue event: its fields from the payload; a closed issue with no row adds none. */
function issueEvent(plan: BoardPlan, ev: Extract<BoardEvent, { kind: 'issue' }>, rows: Map<number, BoardItem>, waiting: Set<number>, now: number) {
  const prev = rows.get(ev.number)
  if (!prev && ev.closedAt) return
  const closedAt = ev.closedAt ? new Date(ev.closedAt) : null
  const next: BoardItem = { ...(prev ?? { number: ev.number, checksRed: false }), title: ev.title, url: ev.url, labels: join(ev.labels), closedAt }
  planRow(plan, prev, next, waiting, now)
}

/**
 * A PR event updates the row of the issue its body closes — only when that row exists (the webhook
 * can't read the issue's labels, so it never adds a row for a PR). Closed → its PR fields are cleared
 * (when it is the row's PR). An older PR than the row's never takes it over (the sync keeps the newest).
 * A new head clears `checksRed`; another PR starts with no verdict. Issue labels are left as they were.
 */
function prEvent(plan: BoardPlan, ev: Extract<BoardEvent, { kind: 'pr' }>, rows: Map<number, BoardItem>, waiting: Set<number>, now: number) {
  const n = closesIssue(ev.body)
  const prev = n === null ? undefined : rows.get(n)
  if (!prev) return
  if (ev.closed) {
    if (prev.prNumber === ev.number) planRow(plan, prev, { ...prev, ...PR_CLEARED }, waiting, now)
    return
  }
  if (hasPr(prev) && prev.prNumber! > ev.number) return
  const next: BoardItem = { ...prev, prNumber: ev.number, prHeadSha: ev.headSha, prBase: ev.base, prLabels: join(ev.labels) }
  if (prev.prNumber !== ev.number) Object.assign(next, { verdict: null, verdictSha: null, checksSha: null })
  if (prev.prHeadSha !== ev.headSha) next.checksRed = false
  planRow(plan, prev, next, waiting, now)
}

/** A pipeline-bot build-review comment on a row's PR sets its verdict; any other comment changes nothing. */
function commentEvent(plan: BoardPlan, ev: Extract<BoardEvent, { kind: 'comment' }>, rows: BoardItem[], waiting: Set<number>, now: number) {
  const prev = rows.find(r => r.prNumber === ev.prNumber)
  const v = prev ? commentVerdict(ev.comment) : null
  if (prev && v) planRow(plan, prev, { ...prev, verdict: v.verdict, verdictSha: v.verdictSha }, waiting, now)
}

/**
 * CI finished on a PR head: `failure` → red, `success` → not red, on rows whose PR is in the run and
 * whose stored head is the run's head (an old run never paints a newer head). Any other conclusion
 * (e.g. `cancelled` when a newer commit lands) changes nothing, `checksSha` included.
 */
function checksEvent(plan: BoardPlan, ev: Extract<BoardEvent, { kind: 'checks' }>, rows: BoardItem[], waiting: Set<number>, now: number) {
  if (ev.conclusion !== 'failure' && ev.conclusion !== 'success') return
  for (const prev of rows) {
    if (!hasPr(prev) || !ev.prNumbers.includes(prev.prNumber!) || prev.prHeadSha !== ev.headSha) continue
    planRow(plan, prev, { ...prev, checksRed: ev.conclusion === 'failure', checksSha: ev.headSha }, waiting, now)
  }
}

/**
 * What one webhook event writes to the board, against the stored rows (never a GitHub read, never a
 * delete). Same row rules as the sync: a new row only when `stageOf` gives a column (so an issue with
 * no pipeline label adds nothing), never for an epic; `stageSince` moves only when the stage changes.
 */
export function boardFromEvent({ event, existing, waiting, now = Date.now() }: {
  event: BoardEvent
  existing: BoardItem[]
  waiting: Set<number>
  now?: number
}): BoardPlan {
  const plan: BoardPlan = { create: [], update: [], remove: [] }
  if (event.kind === 'issue') issueEvent(plan, event, firstBy(existing), waiting, now)
  else if (event.kind === 'pr') prEvent(plan, event, firstBy(existing), waiting, now)
  else if (event.kind === 'comment') commentEvent(plan, event, existing, waiting, now)
  else checksEvent(plan, event, existing, waiting, now)
  return plan
}

// ---------------------------------------------------------------- GET /api/status/board

export interface BoardCard { sourceType: string, sourceNumber: number, state: string, askedAt: When }
export interface BoardRow {
  id: string
  number: number
  title: string
  url: string
  /** The column, worked out now by `stageOf`. */
  column: Stage
  /** ISO time the ticket entered this column, or null when unknown. */
  since: string | null
  /** CI is red on the PR's current head. */
  checksRed: boolean
  /** The `pkg:` / `poc:` / `app:` label without its prefix. */
  pkg: string | null
  order: number
}

const PKG_RE = /^(?:pkg|poc|app):(.+)$/

/** Issue number → the oldest `askedAt` of its waiting cards (a PR card maps through the rows' `prNumber`). */
function waitingSince(rows: BoardItem[], cards: BoardCard[], now: number): Map<number, number> {
  const byPr = new Map<number, number>()
  for (const r of rows) if (hasPr(r)) byPr.set(r.prNumber!, r.number)
  const out = new Map<number, number>()
  for (const c of cards.filter(x => x.state === 'waiting')) {
    const n = c.sourceType === 'pr' ? byPr.get(c.sourceNumber) : c.sourceType === 'issue' ? c.sourceNumber : undefined
    if (n === undefined) continue
    out.set(n, Math.min(out.get(n) ?? Infinity, ms(c.askedAt) ?? now))
  }
  return out
}

/** Issue numbers with a waiting inbox card on the issue or its PR — `stageOf`'s `waiting`. */
export const waitingNumbers = (rows: BoardItem[], cards: BoardCard[], now: number = Date.now()) =>
  new Set(waitingSince(rows, cards, now).keys())

/** When the row entered `column`: the card's askedAt for "you", else stageSince while the stored stage still matches. */
function sinceOf(r: BoardItem, column: Stage, askedAt: Map<number, number>): number | null {
  if (column === 'you') return askedAt.get(r.number) ?? null
  return column === r.stage ? ms(r.stageSince) : null
}

function viewRow(r: BoardItem & { id: string }, column: Stage, sinceMs: number | null, now: number): BoardRow {
  return {
    id: r.id,
    number: r.number,
    title: r.title ?? `#${r.number}`,
    url: r.url ?? '',
    column,
    since: sinceMs === null ? null : new Date(sinceMs).toISOString(),
    checksRed: !!r.checksRed && !!r.prHeadSha && r.checksSha === r.prHeadSha,
    pkg: [...itemLabels(r)].map(l => PKG_RE.exec(l)?.[1]).find(Boolean) ?? null,
    order: sinceMs ?? r.order ?? now
  }
}

/**
 * The board as shown: each row's column from `stageOf` and the current waiting inbox cards (a PR
 * card counts for the row whose `prNumber` it is). "Waits on you" time runs from the card's
 * `askedAt`; otherwise from `stageSince`, only when the stored stage is still the column.
 */
export function boardView(rows: BoardItem[], cards: BoardCard[], now: number = Date.now()): BoardRow[] {
  const askedAt = waitingSince(rows, cards, now)
  const waiting = new Set(askedAt.keys())
  const out: BoardRow[] = []
  for (const r of rows) {
    const column = stageOf(r, waiting, now)
    if (column && r.id) out.push(viewRow(r as BoardItem & { id: string }, column, sinceOf(r, column, askedAt), now))
  }
  return out
}
