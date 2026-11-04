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
 * - `fromPath` is matched against the path with the `/<slug>` prefix removed.
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

export default defineEventHandler(async (event) => {
  const path = getRequestPath(event)

  for (const prefix of SKIP_PREFIXES) {
    if (path.startsWith(prefix)) {
      return
    }
  }

  // Nothing configured => skip the team lookup entirely
  const redirectMap = await getRedirectMap()
  if (redirectMap.size === 0) return

  const pathWithoutQuery = path.split('?')[0] ?? ''
  const segments = pathWithoutQuery.split('/')
  const slug = segments[1]
  const ctxTeamId = (event.context as { resolvedDomainTeamId?: string | null }).resolvedDomainTeamId

  let teamId: string | null | undefined = ctxTeamId
  let matchPath = pathWithoutQuery

  if (slug) {
    const slugTeamId = await getTeamIdForSlug(slug, event)
    if (slugTeamId && (!ctxTeamId || ctxTeamId === slugTeamId)) {
      teamId = slugTeamId
      matchPath = '/' + segments.slice(2).join('/')
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
  if (!teamId) return

  const redirect = findRedirect(redirectMap, teamId, matchPath)

  if (redirect && isSafeRedirectPath(redirect.toPath)) {
    const query = path.includes('?') ? path.slice(path.indexOf('?')) : ''
    return sendRedirect(event, redirect.toPath + query, Number(redirect.statusCode))
  }
})
