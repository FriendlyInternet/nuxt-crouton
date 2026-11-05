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

/**
 * Post the reply unless an identical comment already exists on the target (double-post guard —
 * returns the existing comment's URL instead). PRs use the issue-comments endpoint.
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
    const list = await fetchImpl(`${url}?per_page=100`, { headers })
    if (!list.ok) return { data: null, error: list.status === 403 || list.status === 404 ? permissionHint(reply.kind, list.status) : `GitHub ${list.status}` }
    const comments = (await list.json()) as Array<{ body?: string, html_url: string }>
    const dup = comments.find(c => (c.body ?? '').trim() === reply.body)
    if (dup) return { data: { url: dup.html_url, existing: true }, error: null }

    const res = await fetchImpl(url, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ body: reply.body }) })
    if (!res.ok) return { data: null, error: res.status === 403 || res.status === 404 ? permissionHint(reply.kind, res.status) : `GitHub ${res.status}` }
    const created = (await res.json()) as { html_url: string }
    return { data: { url: created.html_url, existing: false }, error: null }
  } catch (e) {
    return { data: null, error: e instanceof Error ? e.message : String(e) }
  }
}
