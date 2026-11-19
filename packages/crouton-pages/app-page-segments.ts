/**
 * Build-time helper for nuxt.config.ts (#4175).
 *
 * Lives on its own, outside app/utils, so Nuxt's config loader does not pull
 * custom-domain-path.ts / page-path.ts into the process a second time — that
 * double load made v8 report negative branch counts for them, which fallow
 * cannot parse.
 */

/**
 * The sorted, de-duplicated first segment of each page path that is non-empty
 * and not a `:param` — the addresses the app itself owns.
 * `/account` → `account`, `/admin/:team()` → `admin`; `/` and `/:team()/…` are skipped.
 */
export function appPageSegments(pages: ReadonlyArray<{ path: string }>): string[] {
  const segments = new Set<string>()
  for (const page of pages) {
    const first = (page.path || '').split('/').filter(Boolean)[0]
    if (first && !first.includes(':')) segments.add(first)
  }
  return [...segments].sort()
}
