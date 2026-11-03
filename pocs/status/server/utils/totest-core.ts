// Pure helpers for GET /api/status/totest — no Nitro auto-imports, so they unit-test.
export interface ToTestItem {
  kind: 'epic' | 'pr'
  number: number
  title: string
  url: string
  app: string | null
  what: string
  steps: string[]
  /** App path the steps point at (e.g. `/admin/bookings`), or '' when none. */
  to: string
}

/** Text under a "How to test" heading (any level, optional emoji), up to the next heading. */
export function extractHowToTest(body: string | null | undefined): string | null {
  if (!body) return null
  const lines = body.split(/\r?\n/)
  const start = lines.findIndex(l => /^#{1,6}\s+.*how to test/i.test(l))
  if (start === -1) return null
  const out: string[] = []
  for (const l of lines.slice(start + 1)) {
    if (/^#{1,6}\s/.test(l)) break
    out.push(l)
  }
  const text = out.join('\n').trim()
  return text || null
}

/** Numbered / bulleted lines of a How-to-test section, markers stripped. */
export function extractSteps(section: string | null): string[] {
  if (!section) return []
  return section
    .split('\n')
    .map(l => l.match(/^\s*(?:\d+[.)]|[-*])\s+(.*\S)\s*$/)?.[1])
    .filter((s): s is string => !!s)
}

/** First `apps/<x>` or `pocs/<x>` among changed file paths. */
export function appFromFiles(files: string[]): string | null {
  for (const f of files) {
    const m = f.match(/^(?:apps|pocs)\/([^/]+)\//)
    if (m) return m[1]!
  }
  return null
}

/** First non-empty, non-heading line of a body (the "what changed" blurb). */
export function firstParagraph(body: string | null | undefined): string {
  for (const l of (body ?? '').split(/\r?\n/)) {
    const t = l.trim()
    if (t && !t.startsWith('#') && !t.startsWith('<!--') && !t.startsWith('>')) return t.slice(0, 280)
  }
  return ''
}

/** True when any owner comment is an approval ("ok", "lgtm", "approve"). */
export function hasOwnerOk(comments: Array<{ body?: string | null, user?: { login?: string } | null }>, ownerLogin: string | undefined): boolean {
  if (!ownerLogin) return false
  return comments.some(c =>
    c.user?.login?.toLowerCase() === ownerLogin.toLowerCase()
    && /^\s*(ok|okay|lgtm|approved?)\b/i.test(c.body ?? '')
  )
}

/** A redirect target is safe only as a same-origin absolute path: `/x`, never `//host`, `\\`, or a scheme. */
export function isSafePath(to: unknown): to is string {
  return typeof to === 'string'
    && to.length <= 500
    && /^\/(?!\/)/.test(to)
    && !/[\\\u0000-\u001f\u007f]/.test(to)
}

/** First app path (`/admin/x?y=1`) or same-host URL found in the steps, else ''. */
export function extractTargetPath(steps: string[], stagingUrl?: string | null): string {
  let host = ''
  try { host = stagingUrl ? new URL(stagingUrl).host : '' } catch { /* no host to match */ }
  for (const s of steps) {
    const re = /(https?:\/\/[^\s`'"<>)]+)|(?:^|[\s`'"(])(\/[A-Za-z0-9_\-.~%/?=&#:@+,]*)/g
    for (const m of s.matchAll(re)) {
      let path = m[2]
      if (m[1]) {
        try {
          const u = new URL(m[1])
          if (!host || u.host !== host) continue
          path = u.pathname + u.search + u.hash
        } catch { continue }
      }
      path = (path ?? '').replace(/[.,;:]+$/, '')
      if (path.length > 1 && isSafePath(path)) return path
    }
  }
  return ''
}

/** Steps about GitHub itself ("on this PR, the comment appears…") — pipeline checks, not app tests. */
export function isGithubOnly(steps: string[]): boolean {
  return steps.length > 0 && steps.every(s => /\b(on|in) (this|the) (pr|pull request|issue)\b|\bgithub\b|\bthe (pr|pull request) (comment|body|description)\b/i.test(s))
}
