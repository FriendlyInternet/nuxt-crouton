// Pure helpers for GET /api/status/totest — no Nitro auto-imports, so they unit-test.
export interface ToTestItem {
  kind: 'epic' | 'pr'
  number: number
  title: string
  url: string
  app: string | null
  what: string
  steps: string[]
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
