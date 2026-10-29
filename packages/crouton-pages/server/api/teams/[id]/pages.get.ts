/**
 * Get Public Pages for Team
 *
 * Returns published pages for navigation and public display.
 * - Unauthenticated: only public pages
 * - Authenticated team members: public + members pages
 *
 * GET /api/teams/[id]/pages
 *
 * Query params:
 * - navigation=true: Only return pages with showInNavigation=true
 * - visibility: Narrow to one visibility (public, members, admin, scoped); never widens what the caller may see
 * - locale: Locale for translated title/slug (e.g., 'en', 'nl', 'fr')
 * - pageType: Filter by page type (e.g., 'pages:footer') — includes content in response
 */
import { eq, and, or, asc, inArray } from 'drizzle-orm'
import { allowedVisibilities, resolveVisibilities } from '../../../utils/page-visibility'

// NOTE: This is a plain (uncached) handler on purpose. The response is
// auth-dependent (members/admins see more pages via the visibility filter), and
// nitro's defineCachedEventHandler strips request headers from the event passed
// to the handler body — so getServerSession() inside a cached handler can never
// see the session cookie and every request resolves as anonymous. A plain
// handler keeps the cookie, so visibility filtering works.
export default defineEventHandler(async (event) => {
  const teamParam = getRouterParam(event, 'id')

  if (!teamParam) {
    throw createError({
      status: 400,
      statusText: 'Team ID or slug is required'
    })
  }

  const query = getQuery(event)
  const navigationOnly = query.navigation === 'true'
  const visibilityFilter = query.visibility as string | undefined
  const locale = query.locale as string | undefined
  const pageTypeFilter = query.pageType as string | undefined

  try {
    // Import schema - using dynamic import since layer structure
    // In consuming apps, this would be auto-imported
    const database = useDB()

    // First, resolve team ID from slug if needed
    const authSchema = await import('@fyit/crouton-auth/server/database/schema/auth')

    const team = await database
      .select({ id: authSchema.organization.id as any })
      .from(authSchema.organization as any)
      .where(
        or(
          eq(authSchema.organization.id as any, teamParam),
          eq(authSchema.organization.slug as any, teamParam)
        )
      )
      .limit(1)
      .then((rows: Array<{ id: string }>) => rows[0])

    if (!team) {
      throw createError({
        status: 404,
        statusText: 'Team not found'
      })
    }

    // Check for a scoped-access token (volunteers/guests — unlocks 'scoped' pages)
    let hasScopedAccess = false
    try {
      const { validateScopedTokenFromEvent } = await import('@fyit/crouton-auth/server/utils/scoped-access')
      const access = await validateScopedTokenFromEvent(event)
      hasScopedAccess = !!access && access.organizationId === team.id
    } catch {
      // Scoped access not available - continue without
    }

    // Check if user is authenticated and a team member
    let isMember = false
    let isAdmin = false
    try {
      const { getServerSession } = await import('@fyit/crouton-auth/server/utils/useServerAuth')
      const session = await getServerSession(event)

      if (session?.user) {
        // Check team membership and role
        const membership = await database
          .select({ id: authSchema.member.id as any, role: authSchema.member.role as any })
          .from(authSchema.member as any)
          .where(
            and(
              eq(authSchema.member.userId as any, session.user.id),
              eq(authSchema.member.organizationId as any, team.id)
            )
          )
          .limit(1)
          .then((rows: any[]) => rows[0])

        isMember = !!membership
        isAdmin = membership?.role === 'admin' || membership?.role === 'owner'
      }
    } catch {
      // Auth not available or error - continue as unauthenticated
    }

    // Try to get pages from the pagesPages table (shipped by this package, #2278)
    try {
      const pagesSchema = await import('../../../../collections/pages/server/database/schema')

      // Build query conditions
      const conditions = [
        eq(pagesSchema.pagesPages.teamId as any, team.id),
        eq(pagesSchema.pagesPages.status as any, 'published')
      ]

      // Add navigation filter
      if (navigationOnly) {
        conditions.push(eq(pagesSchema.pagesPages.showInNavigation as any, true))
      }

      // Add page type filter
      if (pageTypeFilter) {
        conditions.push(eq(pagesSchema.pagesPages.pageType as any, pageTypeFilter))
      }

      // Add visibility filter based on auth status. Members always include
      // 'scoped' (they pass the slug endpoint's session fallback); anonymous
      // visitors include it only with a valid scoped token for this team.
      const visibilities = resolveVisibilities(
        allowedVisibilities({ isAdmin, isMember, hasScopedAccess }),
        visibilityFilter
      )
      if (visibilities.length === 0) {
        return { data: [], meta: { teamId: team.id, total: 0, locale } }
      }
      conditions.push(inArray(pagesSchema.pagesPages.visibility as any, visibilities))

      // Build select fields — translations/config columns are optional (depends on generated schema)
      const hasTranslations = 'translations' in pagesSchema.pagesPages
      const hasConfig = 'config' in pagesSchema.pagesPages
      const hasContent = 'content' in pagesSchema.pagesPages
      const selectFields: Record<string, any> = {
        id: pagesSchema.pagesPages.id,
        title: pagesSchema.pagesPages.title,
        slug: pagesSchema.pagesPages.slug,
        pageType: pagesSchema.pagesPages.pageType,
        status: pagesSchema.pagesPages.status,
        visibility: pagesSchema.pagesPages.visibility,
        showInNavigation: pagesSchema.pagesPages.showInNavigation,
        parentId: pagesSchema.pagesPages.parentId,
        order: pagesSchema.pagesPages.order,
        depth: pagesSchema.pagesPages.depth,
        path: pagesSchema.pagesPages.path
      }
      // Include content when filtering by pageType (e.g., footer needs block content)
      if (pageTypeFilter && hasContent) {
        selectFields.content = (pagesSchema.pagesPages as any).content
      }
      if (hasTranslations) {
        selectFields.translations = (pagesSchema.pagesPages as any).translations
      }
      if (hasConfig) {
        selectFields.config = (pagesSchema.pagesPages as any).config
      }

      const rawPages = await database
        .select(selectFields)
        .from(pagesSchema.pagesPages as any)
        .where(and(...conditions))
        .orderBy(
          asc(pagesSchema.pagesPages.depth as any),
          asc(pagesSchema.pagesPages.order as any),
          asc(pagesSchema.pagesPages.id as any)
        )

      // Resolve translated values if locale is provided and translations column exists
      const pages = rawPages.map((page: any) => {
        let resolvedTitle = page.title
        let resolvedSlug = page.slug

        if (hasTranslations && page.translations) {
          const translations = page.translations as Record<string, { title?: string; slug?: string }> | null

          // Try to get translated values for the requested locale
          if (locale && translations?.[locale]) {
            resolvedTitle = translations[locale].title || resolvedTitle
            resolvedSlug = translations[locale].slug || resolvedSlug
          }

          // Fallback: if still null, try 'en' as default locale
          if (!resolvedTitle && translations?.en?.title) {
            resolvedTitle = translations.en.title
          }
          if (!resolvedSlug && translations?.en?.slug) {
            resolvedSlug = translations.en.slug
          }
        }

        // Parse config if stored as JSON string
        let config: Record<string, unknown> | null = null
        if (page.config) {
          try {
            config = typeof page.config === 'string' ? JSON.parse(page.config) : page.config
          } catch {
            config = null
          }
        }

        const result: Record<string, any> = {
          id: page.id,
          title: resolvedTitle,
          slug: resolvedSlug,
          pageType: page.pageType,
          status: page.status,
          visibility: page.visibility,
          showInNavigation: page.showInNavigation,
          parentId: page.parentId,
          order: page.order,
          depth: page.depth,
          path: page.path,
          config
        }

        // Include content + translations when filtering by pageType
        if (pageTypeFilter) {
          // Resolve localized content
          let resolvedContent = page.content || null
          if (hasTranslations && page.translations) {
            const translations = page.translations as Record<string, { content?: string }> | null
            if (locale && translations?.[locale]?.content) {
              resolvedContent = translations[locale].content!
            } else if (translations?.en?.content) {
              resolvedContent = translations.en.content
            }
          }
          result.content = resolvedContent
          if (hasTranslations) {
            result.translations = page.translations
          }
        }

        return result
      })

      return {
        data: pages,
        meta: {
          teamId: team.id,
          total: pages.length,
          locale
        }
      }
    } catch {
      // pagesPages table doesn't exist yet
      // Return empty array (collection needs to be generated)
      return {
        data: [],
        meta: {
          teamId: team.id,
          total: 0,
          message: 'Pages collection not generated yet. Run: pnpm crouton generate'
        }
      }
    }
  } catch (error: any) {
    if (error.statusCode) {
      throw error
    }
    console.error('[crouton-pages] Error fetching pages:', error)
    throw createError({
      status: 500,
      statusText: 'Failed to fetch pages'
    })
  }
})
