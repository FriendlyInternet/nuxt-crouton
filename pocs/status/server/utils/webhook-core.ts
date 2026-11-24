// The GitHub webhook receiver's rules (#4309), pure so they unit-test: check the signature, keep only
// this repo's issue/PR events, and mark "something changed on GitHub" in KV. It never calls GitHub and
// never runs the card sync (it only writes the board row the event itself describes, see below) — the next 10-minute clock tick does that (clock-tick.ts, `isDirty`).
//
// Two timestamps, never cleared (not a flag that the clock clears): Cloudflare KV is eventually
// consistent, so a read elsewhere can be ~60 s stale. With a cleared flag a webhook could read a stale
// "set", skip its write, and the change would wait for the next :00/:30. Here both values only grow:
//   DIRTY_KEY  — when a change was last marked (only the webhook writes it, at most every REMARK_MS)
//   SYNCED_KEY — the start time of the last ok, unthrottled clock sync (only the clock writes it)
// and the clock counts a mark newer than `synced-from - DIRTY_MARGIN_MS` as dirty, so a write skipped
// on a stale read is still seen (see isDirty).
//
// The Pipeline board (#4350): a handled event also updates that one board row (`board`, rules in
// board-core.ts `boardFromEvent`), after the dirty mark; a `workflow_run` (CI finished) only updates
// the red-check badge and never marks dirty. Both answer 202 even when the board write fails.
import { createHmac, timingSafeEqual } from 'node:crypto'
import type { BoardEvent } from './board-core'

export const DIRTY_KEY = 'cards-sync:dirty-at'
export const SYNCED_KEY = 'cards-sync:synced-from'
/** The webhook rewrites DIRTY_KEY only when it is missing or older than this (one write per burst). */
export const REMARK_MS = 5 * 60_000
/** How stale a KV read can be (Cloudflare's cache). */
export const KV_STALE_MS = 60_000
export const DIRTY_MARGIN_MS = REMARK_MS + KV_STALE_MS

export const HANDLED_EVENTS = ['issues', 'issue_comment', 'pull_request', 'pull_request_review']

const parse = (v: string | null | undefined): number => (typeof v === 'string' ? Date.parse(v) : Number.NaN)

/** Should the webhook (re)write DIRTY_KEY? Yes when it is missing, unreadable or ≥ REMARK_MS old. */
export function shouldMark(stored: string | null | undefined, nowMs: number): boolean {
  const t = parse(stored)
  if (Number.isNaN(t)) return true
  return nowMs - t >= REMARK_MS
}

/**
 * Does the clock owe a sync? No mark → no. A mark but never a sync → yes. Otherwise yes when the mark
 * is newer than the last sync's start minus DIRTY_MARGIN_MS: a webhook skips its write only after
 * reading a mark ≥ event − REMARK_MS, and a stale read is only ever older, so an event after the sync
 * started always leaves a mark > synced-from − DIRTY_MARGIN_MS.
 */
export function isDirty(dirtyAt: string | null | undefined, syncedFrom: string | null | undefined): boolean {
  const d = parse(dirtyAt)
  if (Number.isNaN(d)) return false
  const s = parse(syncedFrom)
  if (Number.isNaN(s)) return true
  return d > s - DIRTY_MARGIN_MS
}

/** GitHub's `X-Hub-Signature-256: sha256=<hex HMAC-SHA256 of the raw body>`, compared in constant time. */
export function verifySignature(rawBody: string, header: string | undefined, secret: string): boolean {
  if (!secret || !header || !header.startsWith('sha256=')) return false
  const want = Buffer.from(`sha256=${createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex')}`)
  const given = Buffer.from(header)
  if (given.length !== want.length) return false
  return timingSafeEqual(given, want)
}

/** The CI workflow whose result paints the board's red-check badge (= .github/workflows/ci.yml `name:`). */
export const CI_WORKFLOW = 'CI'

interface GhLabelish { name?: unknown }
interface GhIssueish {
  number?: number, title?: unknown, html_url?: unknown, state?: unknown, closed_at?: unknown, labels?: unknown, pull_request?: unknown
}
interface GhPullish {
  number?: number, body?: unknown, state?: unknown, labels?: unknown, head?: { sha?: unknown }, base?: { ref?: unknown }
}

/** The few fields of a GitHub webhook body we read; every one may be absent. */
interface GithubPayload {
  action?: unknown
  issue?: GhIssueish
  pull_request?: GhPullish
  comment?: { id?: number | string, body?: unknown, user?: { login?: unknown, type?: unknown } | null, created_at?: unknown, html_url?: unknown }
  workflow_run?: { name?: unknown, head_sha?: unknown, conclusion?: unknown, pull_requests?: Array<{ number?: unknown }> }
  repository?: { full_name?: unknown }
}

export type ParsedWebhook =
  | { ok: false, status: 400 | 401 }
  | { ok: true, event: string, action: string | null, number: number | null, isPr: boolean, repo: string | null, board: BoardEvent | null }

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null)
const labelsOf = (v: unknown): string[] =>
  Array.isArray(v) ? v.map(l => (typeof l === 'string' ? l : str((l as GhLabelish)?.name))).filter((l): l is string => !!l) : []

function issueOf(i: GhIssueish): BoardEvent | null {
  if (typeof i.number !== 'number' || i.pull_request) return null
  return { kind: 'issue', number: i.number, title: str(i.title) ?? '', url: str(i.html_url) ?? '', labels: labelsOf(i.labels), closedAt: i.state === 'closed' ? (str(i.closed_at) ?? new Date().toISOString()) : null }
}

function pullOf(p: GhPullish): BoardEvent | null {
  if (typeof p.number !== 'number') return null
  return { kind: 'pr', number: p.number, body: str(p.body), labels: labelsOf(p.labels), headSha: str(p.head?.sha), base: str(p.base?.ref), closed: p.state === 'closed' }
}

function checksOf(action: unknown, run: NonNullable<GithubPayload['workflow_run']>): BoardEvent | null {
  const headSha = str(run.head_sha)
  if (action !== 'completed' || run.name !== CI_WORKFLOW || !headSha) return null
  const prNumbers = (run.pull_requests ?? []).map(p => p?.number).filter((n): n is number => typeof n === 'number')
  return prNumbers.length ? { kind: 'checks', headSha, prNumbers, conclusion: str(run.conclusion) ?? '' } : null
}

/** A comment on a PR → a `comment` event (may carry a build-review verdict). */
function prCommentOf(prNumber: unknown, c: GithubPayload['comment']): BoardEvent | null {
  if (typeof prNumber !== 'number' || !c) return null
  const user = c.user ? { login: str(c.user.login), type: str(c.user.type) } : null
  return { kind: 'comment', prNumber, comment: { id: c.id ?? 0, body: str(c.body), user, created_at: str(c.created_at) ?? '' } }
}

/** An `issue_comment`: on a plain issue its issue fields, on a PR the comment. */
function commentOf(body: GithubPayload): BoardEvent | null {
  if (!body.issue) return null
  return body.issue.pull_request ? prCommentOf(body.issue.number, body.comment) : issueOf(body.issue)
}

const pullEventOf = (b: GithubPayload) => (b.pull_request ? pullOf(b.pull_request) : null)

/** Event name → how its payload becomes a board event. */
const BOARD_EVENTS: Record<string, (b: GithubPayload) => BoardEvent | null> = {
  workflow_run: b => (b.workflow_run ? checksOf(b.action, b.workflow_run) : null),
  pull_request: pullEventOf,
  pull_request_review: pullEventOf,
  issues: b => (b.issue ? issueOf(b.issue) : null),
  issue_comment: commentOf
}

/** The board's view of one event, from the payload alone (no GitHub read), or null when it has none. */
export function boardEventOf(event: string, body: GithubPayload | null): BoardEvent | null {
  const of = Object.hasOwn(BOARD_EVENTS, event) ? BOARD_EVENTS[event] : undefined
  return body && of ? of(body) : null
}

/** Check the signature, then read the event. Header names are read lower-case. */
export function parseWebhook(headers: Record<string, string | undefined>, rawBody: string, secret: string): ParsedWebhook {
  if (!verifySignature(rawBody, headers['x-hub-signature-256'], secret)) return { ok: false, status: 401 }
  let body: GithubPayload | null
  try {
    body = JSON.parse(rawBody) as GithubPayload | null
  } catch {
    return { ok: false, status: 400 }
  }
  return {
    ok: true,
    event: String(headers['x-github-event'] ?? ''),
    action: typeof body?.action === 'string' ? body.action : null,
    number: body?.issue?.number ?? body?.pull_request?.number ?? null,
    isPr: !!body?.pull_request || !!body?.issue?.pull_request,
    repo: typeof body?.repository?.full_name === 'string' ? body.repository.full_name : null,
    board: boardEventOf(String(headers['x-github-event'] ?? ''), body)
  }
}

export interface WebhookStore {
  getItem: (key: string) => Promise<unknown>
  setItem: (key: string, value: string) => Promise<void>
}

/** Writes one event to the board (server/utils/board-webhook.ts `writeBoardEvent`). May throw. */
export type BoardWriter = (event: BoardEvent) => Promise<unknown>

/** Runs the board write; a failure is logged and never changes the answer. */
async function writeBoardSafely(board: BoardWriter | undefined, event: BoardEvent | null) {
  if (!board || !event) return
  try {
    await board(event)
  } catch (e) {
    console.error('[webhook] board write failed', e)
  }
}

/**
 * 401 bad signature (400 bad JSON) · 200 ping · 204 another repo or an unhandled event ·
 * 202 `workflow_run` (board badge only, never the dirty mark) ·
 * 202 a handled event, after marking DIRTY_KEY (only when shouldMark says so) and then the board write.
 */
export async function handleWebhook(args: {
  headers: Record<string, string | undefined>
  rawBody: string
  secret: string
  repo: string
  store: WebhookStore
  board?: BoardWriter
  now?: number
}): Promise<{ status: number }> {
  const { headers, rawBody, secret, repo, store, board, now = Date.now() } = args
  const p = parseWebhook(headers, rawBody, secret)
  if (!p.ok) return { status: p.status }
  if (p.event === 'ping') return { status: 200 }
  if (p.repo !== repo) return { status: 204 }
  if (p.event === 'workflow_run') {
    await writeBoardSafely(board, p.board)
    return { status: 202 }
  }
  if (!HANDLED_EVENTS.includes(p.event)) return { status: 204 }
  const stored = await store.getItem(DIRTY_KEY)
  if (shouldMark(typeof stored === 'string' ? stored : null, now)) await store.setItem(DIRTY_KEY, new Date(now).toISOString())
  await writeBoardSafely(board, p.board)
  return { status: 202 }
}
