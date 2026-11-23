// Pure helpers for the changelog route — no Nitro auto-imports, so they unit-test.
export interface GhPull {
  number: number
  title: string
  html_url: string
  merged_at: string | null
  head?: { ref?: string }
  labels?: Array<{ name: string }>
  body?: string | null
}

/** One item of the issue search: its number and labels (GitHub gives `{ name }` objects). */
export interface GhIssueLabels {
  number: number
  labels?: Array<{ name: string } | string>
}

export type ChangeKind = 'new' | 'fix' | 'chore' | 'change'

export interface ChangelogRow {
  date: string
  /** Full merge timestamp (ISO) — the UI groups by the owner's day, not the UTC `date`. */
  mergedAt: string
  number: number
  title: string
  area: string
  kind: ChangeKind
  url: string
}

const REPO = 'FriendlyInternet/nuxt-crouton'

/** A conventional-commit prefix: `feat(velo)!: ` — shared by stripTitle and deriveKind. */
const PREFIX = /^\s*(feat|fix|refactor|docs|test|chore|perf|style|ci|build|revert)(\([^)]*\))?!?:\s*/i

/** Drop a leading conventional-commit prefix: `feat(velo)!: x` -> `x`. */
export function stripTitle(title: string): string {
  const stripped = title.replace(PREFIX, '').trim()
  const text = stripped || title.trim()
  return text.charAt(0).toUpperCase() + text.slice(1)
}

const AREAS: Array<[RegExp, string]> = [
  [/velo/, 'Velo'],
  [/kassa/, 'Kassa'],
  [/builder/, 'Builder'],
  [/crate/, 'Crate'],
  [/\bpkg\b|packages?\b|crouton-/, 'Shared packages'],
  [/pipeline|workflow|harness|\bci\b|\.github/, 'Pipeline']
]

/** Pipeline bookkeeping labels — they say how a PR was built, never what it touched. */
const BOOKKEEPING = /^(ci-fix-attempts:|build:|pipeline:|status:|plan:)/
const PIPELINE_LABELS = new Set(['workflow', 'meta:agents', 'ci'])

const names = (labels: Array<{ name: string } | string> = []) =>
  labels.map(l => (typeof l === 'string' ? l : l?.name ?? '')).filter(Boolean)

/**
 * The PR's linked issue: `N` from a `work-<N>` branch, else the first `Closes #N` in the body.
 * The body rule is a copy of `closesIssue` in `server/utils/cards-sync-run.ts` — keep in step.
 */
export function issueNumber(pr: Pick<GhPull, 'head' | 'body'>): number | null {
  const b = /^work-(\d+)/.exec(pr.head?.ref ?? '')
  if (b) return Number(b[1])
  const m = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#(\d+)/i.exec(pr.body ?? '')
  return m ? Number(m[1]) : null
}

/** The one issue search that covers every linked issue: closed since the oldest merge in the list. */
export function issueSearchPath(pulls: Array<Pick<GhPull, 'merged_at'>>, page = 1): string | null {
  const merged = pulls.map(p => p.merged_at).filter((d): d is string => !!d).sort()
  if (!merged.length) return null
  const day = merged[0]!.slice(0, 10)
  const q = encodeURIComponent(`repo:${REPO} is:issue is:closed closed:>=${day}`)
  return `/search/issues?q=${q}&sort=updated&order=desc&per_page=100&page=${page}`
}

/** Issue number → label names. */
export function issueLabelMap(items: GhIssueLabels[]): Map<number, string[]> {
  return new Map(items.map(i => [i.number, names(i.labels)]))
}

/**
 * The component a change touched. Issue labels first, then the PR's; bookkeeping labels never count.
 * `app:`/`poc:` → its name; else `pkg:` → `<name> · all apps`; else a pipeline label; else the old
 * branch/title guesses; else `Other`.
 */
export function deriveArea(pr: Pick<GhPull, 'title' | 'head' | 'labels'>, issueLabels: string[] = []): string {
  const labels = [...issueLabels, ...names(pr.labels)].filter(l => !BOOKKEEPING.test(l))
  for (const l of labels) {
    const m = /^(?:app|poc):(.+)$/.exec(l)
    if (m) return m[1]!
  }
  for (const l of labels) {
    const m = /^pkg:(.+)$/.exec(l)
    if (m) return `${m[1]} · all apps`
  }
  if (labels.some(l => PIPELINE_LABELS.has(l))) return 'Pipeline'
  const sources = [labels.join(' '), pr.head?.ref ?? '', pr.title]
  for (const src of sources) {
    const s = src.toLowerCase()
    for (const [re, area] of AREAS) if (re.test(s)) return area
  }
  return 'Other'
}

/** What kind of change: `type:*` labels first, then the title's conventional prefix. */
export function deriveKind(title: string, labels: string[] = []): ChangeKind {
  if (labels.includes('type:feat')) return 'new'
  if (labels.includes('type:fix')) return 'fix'
  if (labels.some(l => l === 'type:chore' || l === 'type:docs' || l === 'type:test')) return 'chore'
  const p = PREFIX.exec(title)?.[1]?.toLowerCase()
  if (p === 'feat') return 'new'
  if (p === 'fix') return 'fix'
  if (p && ['chore', 'docs', 'test', 'ci', 'build'].includes(p)) return 'chore'
  return 'change'
}

/** Merged PRs within `days` of `now`, newest first. `issues` = linked issue labels (null → PR labels only). */
export function buildChangelog(
  pulls: GhPull[],
  now: Date = new Date(),
  days = 30,
  issues: Map<number, string[]> | null = null
): ChangelogRow[] {
  const cutoff = now.getTime() - days * 86_400_000
  return pulls
    .filter(p => p.merged_at && Date.parse(p.merged_at) >= cutoff)
    .sort((a, b) => Date.parse(b.merged_at!) - Date.parse(a.merged_at!))
    .map((p) => {
      const n = issueNumber(p)
      const il = (n != null && issues?.get(n)) || []
      return {
        date: p.merged_at!.slice(0, 10),
        mergedAt: p.merged_at!,
        number: p.number,
        title: stripTitle(p.title),
        area: deriveArea(p, il),
        kind: deriveKind(p.title, [...il, ...names(p.labels)]),
        url: p.html_url
      }
    })
}
