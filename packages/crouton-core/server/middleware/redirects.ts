/**
 * Server middleware that handles URL redirects.
 *
 * - Skips /api/, /admin/, /_nuxt/, /auth/ paths for performance
 * - Redirects are scoped to a team: the request's team comes from the custom
 *   domain (`resolvedDomainTeamId`) or the first path segment (team slug).
 *   No resolvable team => no redirect.
 * - `fromPath` is matched against the path with the `/<slug>` prefix removed.
 * - Only same-site targets are followed.
 */
import { findRedirect, getRedirectMap, getTeamIdForSlug } from '../utils/redirectCache'
import { isSafeRedirectPath } from '../utils/redirectValidation'

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
  if (!teamId) return

  const redirect = findRedirect(redirectMap, teamId, matchPath)

  if (redirect && isSafeRedirectPath(redirect.toPath)) {
    const query = path.includes('?') ? path.slice(path.indexOf('?')) : ''
    return sendRedirect(event, redirect.toPath + query, Number(redirect.statusCode))
  }
})
