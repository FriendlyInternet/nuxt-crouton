/**
 * Domain Resolution Plugin (Nitro Plugin)
 *
 * Resolves custom domains to team context and rewrites URLs.
 * Must be a Nitro plugin (not middleware) because h3's createAppEventHandler
 * resets event._path and event.node.req.url on each handler iteration,
 * silently discarding middleware URL rewrites.
 *
 * Example:
 * - Request: booking.acme.com/about
 * - Domain lookup: booking.acme.com → team "acme"
 * - Rewrite: /about → /acme/about
 * - Result: [team]/[...slug].vue handles it normally
 */
import { eq, and } from 'drizzle-orm'
import * as authSchema from '@fyit/crouton-auth/server/database/schema/auth'
import type { TeamSiteSettings } from '@fyit/crouton-auth/server/database/schema/auth'

// Extend H3EventContext for domain resolution
declare module 'h3' {
  interface H3EventContext {
    /** The custom domain that was resolved (if any) */
    resolvedDomain?: string | null
    /** Team ID resolved from custom domain */
    resolvedDomainTeamId?: string | null
    /** Whether this request came from a custom domain */
    isCustomDomain?: boolean
  }
}

// Skip these hosts (not custom domains)
const SKIP_HOSTS = [
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
]

// Skip these paths (API routes, auth, etc.)
const SKIP_PATH_PREFIXES = [
  '/api/',
  '/_nuxt/',
  '/__nuxt',
  '/auth/',
  '/admin/',
]

export default defineNitroPlugin((nitroApp) => {
  const originalHandler = nitroApp.h3App.handler

  nitroApp.h3App.handler = defineEventHandler(async (event) => {
    const path = event.node.req.url || '/'

    // Skip API routes and internal paths
    if (SKIP_PATH_PREFIXES.some(prefix => path.startsWith(prefix))) {
      return originalHandler(event)
    }

    // Get the request host
    const host = getRequestHost(event, { xForwardedHost: true })

    if (!host) {
      return originalHandler(event)
    }

    // Skip localhost and IP addresses
    const hostname = host.split(':')[0] // Remove port if present
    if (!hostname || SKIP_HOSTS.includes(hostname)) {
      return originalHandler(event)
    }

    // A slug-shaped first segment (e.g., /acme/about) is not rewritten, but the
    // host's team is still resolved so team-scoped middleware (redirects) can
    // use the host, never the path, to pick the team.
    let hasTeamSegment = false
    const pathSegments = path.split('/').filter(Boolean)
    if (pathSegments.length >= 1) {
      const firstSegment = pathSegments[0]
      if (firstSegment && /^[a-z0-9][a-z0-9-]*$/i.test(firstSegment) && !firstSegment.includes('.')) {
        hasTeamSegment = true
      }
    }

    // Skip common app domains (configure via runtime config)
    const config = useRuntimeConfig()
    const appDomains = (config.public?.croutonPages?.appDomains as string[] | undefined) || []

    if (appDomains.some(d => hostname === d || hostname.endsWith(`.${d}`))) {
      return originalHandler(event)
    }

    // Skip static files (anything with a dot in the last segment)
    const lastSegment = path.split('/').pop() || ''
    if (lastSegment.includes('.')) {
      return originalHandler(event)
    }

    // Look up the domain in the database
    try {
      const database = useDB()

      const domainRecord = await database
        .select({
          domain: authSchema.domain.domain,
          organizationId: authSchema.domain.organizationId,
          status: authSchema.domain.status,
        })
        .from(authSchema.domain)
        .where(
          and(
            eq(authSchema.domain.domain, hostname),
            eq(authSchema.domain.status, 'verified'),
          ),
        )
        .limit(1)
        .then((rows: Array<{ domain: string; organizationId: string; status: string }>) => rows[0])

      if (!domainRecord) {
        return originalHandler(event)
      }

      const orgRecord = await database
        .select({
          slug: authSchema.organization.slug,
        })
        .from(authSchema.organization)
        .where(eq(authSchema.organization.id, domainRecord.organizationId))
        .limit(1)
        .then((rows: Array<{ slug: string }>) => rows[0])

      if (!orgRecord) {
        return originalHandler(event)
      }

      // Check if public site is enabled for this team
      const siteSettingsRecord = await database
        .select({
          siteSettings: authSchema.teamSettings.siteSettings,
        })
        .from(authSchema.teamSettings)
        .where(eq(authSchema.teamSettings.teamId, domainRecord.organizationId))
        .limit(1)
        .then((rows: Array<{ siteSettings: TeamSiteSettings | null }>) => rows[0])

      const siteSettings = siteSettingsRecord?.siteSettings
      if (siteSettings && siteSettings.publicSiteEnabled === false) {
        return originalHandler(event)
      }

      // Store in context for other middleware/pages to use
      event.context.resolvedDomain = hostname
      event.context.resolvedDomainTeamId = domainRecord.organizationId
      event.context.isCustomDomain = true

      // Rewrite the URL before h3 processes it
      const newPath = hasTeamSegment ? path : `/${orgRecord.slug}${path === '/' ? '' : path}`
      event.node.req.url = newPath

      if (config.public?.croutonPages?.debug) {
        console.log(`[crouton-pages] Domain resolved: ${hostname} → team ${orgRecord.slug}, path ${path} → ${newPath}`)
      }
    }
    catch (error) {
      console.error('[crouton-pages] Domain resolution error:', error)
    }

    return originalHandler(event)
  })
})
