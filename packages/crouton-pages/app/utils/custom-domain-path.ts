/**
 * Custom Domain Path Rules (#4175)
 *
 * Pure path rules shared by the server domain resolver, the browser router
 * history (team-host-history.ts) and the public page forwards. No Nuxt globals,
 * so the Nitro plugin can import this file by relative path. nuxt.config.ts
 * must NOT import it (see ../../app-page-segments.ts).
 *
 * On a connected domain in team routing mode every non-app path belongs to that
 * host's team: `/about` → `/acme/about`, `/en/about` → `/acme/en/about`. The
 * app's own top-level pages (read from the page tree at build time), the
 * reserved prefixes and `_*` segments are left alone.
 */
import { buildPagePath } from './page-path'
import { RESERVED_PREFIXES } from './reserved-prefixes'

/** True when the domain lookup itself can be skipped (reserved prefixes, `_*`). */
export function skipsDomainLookup(seg?: string): boolean {
  if (!seg) return false
  return RESERVED_PREFIXES.includes(seg) || seg.startsWith('_')
}

/** True when the first segment is an address the app owns (never rewritten). */
export function isAppOwnedSegment(seg: string | undefined, appSegments: readonly string[]): boolean {
  if (!seg) return false
  return skipsDomainLookup(seg) || appSegments.includes(seg)
}

function splitSearch(url: string): { pathname: string, search: string } {
  const idx = url.search(/[?#]/)
  if (idx === -1) return { pathname: url, search: '' }
  return { pathname: url.slice(0, idx), search: url.slice(idx) }
}

/**
 * The team-prefixed path for a request on a connected host, or `null` to leave
 * it alone (app-owned, already this team's prefix, or a static file).
 */
export function rewriteForTeamHost(url: string, teamSlug: string, appSegments: readonly string[]): string | null {
  const { pathname, search } = splitSearch(url || '/')
  const segments = pathname.split('/').filter(Boolean)
  const first = segments[0]
  if (isAppOwnedSegment(first, appSegments)) return null
  if (first === teamSlug) return null
  const last = segments[segments.length - 1] || ''
  if (last.includes('.')) return null
  if (segments.length === 0) return `/${teamSlug}${search}`
  return `/${teamSlug}${pathname.startsWith('/') ? pathname : `/${pathname}`}${search}`
}

/**
 * Strip this team's leading prefix: `/acme` → `/`, `/acme/x` → `/x`,
 * `/acme?q=1` → `/?q=1`. Any other path is returned unchanged.
 */
export function stripTeamPrefix(path: string, teamSlug: string): string {
  const prefix = `/${teamSlug}`
  if (!path.startsWith(prefix)) return path
  const rest = path.slice(prefix.length)
  if (rest === '') return '/'
  if (rest.startsWith('/')) return rest
  if (rest.startsWith('?') || rest.startsWith('#')) return `/${rest}`
  return path
}

/**
 * Team-ful target for an address without a language on a connected domain:
 * `/acme/about` (team=acme, locale=about) → `/acme/<defaultLocale>/about`.
 */
export function localeLessTarget(team: string, localeParam: string, slugPath: string, defaultLocale: string): string {
  return buildPagePath({
    hideTeamInUrl: false,
    team,
    locale: defaultLocale,
    slugPath: [localeParam, slugPath].filter(Boolean).join('/')
  })
}
