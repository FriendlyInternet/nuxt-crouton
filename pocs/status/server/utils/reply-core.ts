// Pure helpers for POST /api/reply — post `ok` / `not ok: <note>` on an epic or PR as the owner.
// No Nitro auto-imports, so they unit-test.
import type { GhResult } from './github-core'

const GH_API = 'https://api.github.com'

export interface ReplyInput {
  kind?: unknown
  number?: unknown
  verdict?: unknown
  note?: unknown
}

export interface ParsedReply {
  kind: 'issue' | 'pr'
  number: number
  body: string
}

/** Validate input and map the verdict to the exact comment body (`ok` or `not ok: <note>`; never `lgtm`). */
export function buildReply(input: ReplyInput): GhResult<ParsedReply> {
  const kind = input.kind
  if (kind !== 'issue' && kind !== 'pr') return { data: null, error: 'kind must be "issue" or "pr"' }
  const number = Number(input.number)
  if (!Number.isInteger(number) || number <= 0) return { data: null, error: 'number must be a positive integer' }
  if (input.verdict === 'ok') return { data: { kind, number, body: 'ok' }, error: null }
  if (input.verdict === 'not-ok') {
    const note = typeof input.note === 'string' ? input.note.trim() : ''
    if (!note) return { data: null, error: 'a "not ok" verdict needs a note' }
    return { data: { kind, number, body: `not ok: ${note}` }, error: null }
  }
  return { data: null, error: 'verdict must be "ok" or "not-ok"' }
}

function permissionHint(kind: 'issue' | 'pr', status: number): string {
  const perm = kind === 'pr' ? 'Pull requests: Read and write' : 'Issues: Read and write'
  return `GitHub ${status}: the token is missing the "${perm}" permission (or the ${kind === 'pr' ? 'PR' : 'issue'} does not exist)`
}

export interface TimelineEvent {
  event?: string
  body?: string
  html_url?: string
}

/** A comment that is itself a verdict (`ok` / `not ok: …`) — a different one ends the duplicate window. */
const VERDICT = /^\s*(?:not\s+)?ok\b/i

/**
 * Newest → oldest: an identical `commented` body is a duplicate (return its URL). The search stops
 * (no duplicate) at a commit / PR reference or at a different verdict, because the earlier `ok`
 * then described older work and a fresh one must still post.
 */
export function findRecentDuplicate(events: TimelineEvent[], body: string): string | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]!
    if (e.event === 'commented') {
      const text = (e.body ?? '').trim()
      if (text === body) return e.html_url ?? null
      if (VERDICT.test(text)) return null
    } else if (e.event === 'committed' || e.event === 'referenced' || e.event === 'cross-referenced') {
      return null
    }
  }
  return null
}

const MAX_TIMELINE_PAGES = 10
const nextLink = (link: string | null) => /<([^>]+)>;\s*rel="next"/.exec(link ?? '')?.[1] ?? null

/** Read the issue timeline, following `Link: rel="next"` up to MAX_TIMELINE_PAGES. */
async function readTimeline(
  first: string,
  headers: Record<string, string>,
  kind: ParsedReply['kind'],
  fetchImpl: typeof fetch
): Promise<{ data: TimelineEvent[], error: null } | { data: null, error: string }> {
  const events: TimelineEvent[] = []
  let next: string | null = first
  for (let page = 0; next && page < MAX_TIMELINE_PAGES; page++) {
    const list: Response = await fetchImpl(next, { headers })
    if (!list.ok) return { data: null, error: list.status === 403 || list.status === 404 ? permissionHint(kind, list.status) : `GitHub ${list.status}` }
    events.push(...((await list.json()) as TimelineEvent[]))
    next = nextLink(list.headers.get('link'))
  }
  return { data: events, error: null }
}

/**
 * Post the reply unless an identical comment already exists since the latest commit/reference or
 * other verdict (double-post guard — returns the existing comment's URL instead). Reads the issue
 * timeline (paginated). PRs use the issue-comments endpoint.
 */
export async function postReply(
  repo: string,
  reply: ParsedReply,
  token: string | undefined,
  fetchImpl: typeof fetch = fetch
): Promise<GhResult<{ url: string, existing: boolean }>> {
  if (!token) return { data: null, error: 'GITHUB_TOKEN is not configured' }
  const headers = {
    'Authorization': `Bearer ${token}`,
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'crouton-status'
  }
  const url = `${GH_API}/repos/${repo}/issues/${reply.number}/comments`
  try {
    const tl = await readTimeline(`${GH_API}/repos/${repo}/issues/${reply.number}/timeline?per_page=100`, headers, reply.kind, fetchImpl)
    if (tl.error) return { data: null, error: tl.error }
    const events = tl.data
    const dup = findRecentDuplicate(events, reply.body)
    if (dup) return { data: { url: dup, existing: true }, error: null }

    const res = await fetchImpl(url, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ body: reply.body }) })
    if (!res.ok) return { data: null, error: res.status === 403 || res.status === 404 ? permissionHint(reply.kind, res.status) : `GitHub ${res.status}` }
    const created = (await res.json()) as { html_url: string }
    return { data: { url: created.html_url, existing: false }, error: null }
  } catch (e) {
    return { data: null, error: e instanceof Error ? e.message : String(e) }
  }
}
