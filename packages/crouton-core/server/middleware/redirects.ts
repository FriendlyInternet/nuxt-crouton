/**
 * Server middleware that handles URL redirects.
 *
 * - Skips /api/, /admin/, /_nuxt/, /auth/ paths for performance
 * - Redirects are scoped to a team: the request's team comes from the custom
 *   domain (`resolvedDomainTeamId`) or the first path segment (team slug).
 *   No resolvable team => no redirect.
 * - Single-team apps with no team segment in the URL fall back to the
 *   configured `defaultTeamSlug` (matched against the full path).
 * - The slug is looked up per request (no cache): a renamed slug taken by
 *   another team must not inherit the old team's redirects.
 * - `fromPath` is matched against the path with the `/<slug>` prefix removed,
 *   then (legacy rows) the full path; both scoped to the resolved team.
 * - A `/<slug>/…` request keeps the prefix on same-site targets.
 * - Only same-site targets are followed.
 */
import { findRedirect, getRedirectMap } from '../utils/redirectCache'
import { isSafeRedirectPath } from '../utils/redirectValidation'

/** Resolve a team slug to its id, per request. */
async function getTeamIdForSlug(slug: string, event: any): Promise<string | null> {
  try {
    const { getTeamBySlug } = await import('@fyit/crouton-auth/server/utils/team')
    return (await getTeamBySlug(event, slug))?.id ?? null
  } catch {
    return null
  }
}

const SKIP_PREFIXES = ['/api/', '/admin/', '/_nuxt/', '/auth/', '/__nuxt']

function isSkippedPath(path: string): boolean {
  return SKIP_PREFIXES.some(prefix => path.startsWith(prefix))
}

/** Find the team for this request and the path to match redirects against. */
async function resolveTeam(event: any, pathWithoutQuery: string): Promise<{ teamId: string | null | undefined, matchPath: string, prefix: string | null }> {
  const segments = pathWithoutQuery.split('/')
  const slug = segments[1]
  const ctxTeamId = (event.context as { resolvedDomainTeamId?: string | null }).resolvedDomainTeamId

  let teamId: string | null | undefined = ctxTeamId
  let matchPath = pathWithoutQuery
  let prefix: string | null = null

  if (slug) {
    const slugTeamId = await getTeamIdForSlug(slug, event)
    if (slugTeamId && (!ctxTeamId || ctxTeamId === slugTeamId)) {
      teamId = slugTeamId
      matchPath = '/' + segments.slice(2).join('/')
      // Custom domain: the host picked the team, so targets stay as stored
      if (!ctxTeamId) prefix = slug
    }
  }
  if (!teamId) {
    // Single-team app: no team segment in the URL, use the default team
    const defaultSlug = (useRuntimeConfig(event).public as any)?.crouton?.auth?.teams?.defaultTeamSlug as string | undefined
    if (defaultSlug) {
      teamId = await getTeamIdForSlug(defaultSlug, event)
      matchPath = pathWithoutQuery
    }
  }
  return { teamId, matchPath, prefix }
}

/** Send the redirect (keeping the query string) when the target is safe. */
function applyRedirect(event: any, path: string, redirect: { toPath: string, statusCode: number | string }, prefix: string | null) {
  const query = path.includes('?') ? path.slice(path.indexOf('?')) : ''
  let to = redirect.toPath
  // Request came in as /<slug>/…: keep the team prefix on same-site targets
  if (prefix && to.startsWith('/') && !to.startsWith('//') && to !== `/${prefix}` && !to.startsWith(`/${prefix}/`) && !to.startsWith(`/${prefix}?`)) {
    to = `/${prefix}${to === '/' ? '' : to}`
  }
  return sendRedirect(event, to + query, Number(redirect.statusCode))
}

export default defineEventHandler(async (event) => {
  const path = getRequestPath(event)
  if (isSkippedPath(path)) return

  // Nothing configured => skip the team lookup entirely
  const redirectMap = await getRedirectMap()
  if (redirectMap.size === 0) return

  const pathWithoutQuery = path.split('?')[0] ?? ''
  const { teamId, matchPath, prefix } = await resolveTeam(event, pathWithoutQuery)
  if (!teamId) return

  // Rows saved before team scoping may carry the prefix (`/acme/old`): same team only
  const redirect = findRedirect(redirectMap, teamId, matchPath)
    ?? (prefix ? findRedirect(redirectMap, teamId, pathWithoutQuery) : undefined)
  if (redirect && isSafeRedirectPath(redirect.toPath)) {
    return applyRedirect(event, path, redirect, prefix)
  }
})
