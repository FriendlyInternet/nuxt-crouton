// Pure helpers for the changelog route — no Nitro auto-imports, so they unit-test.
export interface GhPull {
  number: number
  title: string
  html_url: string
  merged_at: string | null
  head?: { ref?: string }
  labels?: Array<{ name: string }>
}

export interface ChangelogRow {
  date: string
  number: number
  title: string
  area: string
  url: string
}

/** Drop a leading conventional-commit prefix: `feat(velo)!: x` -> `x`. */
export function stripTitle(title: string): string {
  const stripped = title.replace(/^\s*(feat|fix|refactor|docs|test|chore|perf|style|ci|build|revert)(\([^)]*\))?!?:\s*/i, '').trim()
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

/** Derive the app/area from labels first, then branch name, then title. */
export function deriveArea(pr: Pick<GhPull, 'title' | 'head' | 'labels'>): string {
  const sources = [
    (pr.labels ?? []).map(l => l.name).join(' '),
    pr.head?.ref ?? '',
    pr.title
  ]
  for (const src of sources) {
    const s = src.toLowerCase()
    for (const [re, area] of AREAS) if (re.test(s)) return area
  }
  return 'Other'
}

/** Merged PRs within `days` of `now`, newest first. */
export function buildChangelog(pulls: GhPull[], now: Date = new Date(), days = 30): ChangelogRow[] {
  const cutoff = now.getTime() - days * 86_400_000
  return pulls
    .filter(p => p.merged_at && Date.parse(p.merged_at) >= cutoff)
    .sort((a, b) => Date.parse(b.merged_at!) - Date.parse(a.merged_at!))
    .map(p => ({
      date: p.merged_at!.slice(0, 10),
      number: p.number,
      title: stripTitle(p.title),
      area: deriveArea(p),
      url: p.html_url
    }))
}
