/// <reference path="../../../../crouton-hooks.d.ts" />
/**
 * Get Single Page by Slug (Catch-All)
 *
 * Returns a single page for public rendering.
 * Handles single-segment slugs (regular pages) and multi-segment slugs
 * for collection binder sub-routes (e.g. /locations/abc123).
 *
 * Single-segment: finds page directly by slug.
 * Two-segment: finds the binder page by first segment, injects second segment
 * as `config.binderItemId` for the CollectionBinderRenderer to use.
 *
 * GET /api/teams/[id]/pages/[...slug]
 */
import { eq, and, or, asc } from 'drizzle-orm'

interface RequiredScope {
  resourceType?: string
  resourceId?: string
  nameRequired?: boolean
}

interface PageChrome {
  hideNav?: boolean
  hideAuthControls?: boolean
}

/** Shared lookup context threaded through the page-resolution helpers. */
interface PageLookupCtx {
  database: any
  pagesSchema: any
  sql: any
  teamId: string
  locale: string
}

/** Resolve the team by id or slug; 404 when it doesn't exist. */
async function resolveTeam(database: any, authSchema: any, teamParam: string): Promise<{ id: string, slug: string }> {
  const team = await database
    .select({ id: authSchema.organization.id as any, slug: authSchema.organization.slug as any })
    .from(authSchema.organization as any)
    .where(
      or(
        eq(authSchema.organization.id as any, teamParam),
        eq(authSchema.organization.slug as any, teamParam)
      )
    )
    .limit(1)
    .then((rows: Array<{ id: string; slug: string }>) => rows[0])

  if (!team) {
    throw createError({
      status: 404,
      statusText: 'Team not found'
    })
  }

  return team
}

// Localized slug for a page row: translated slug for the locale, else base.
function rowLocalizedSlug(row: any, locale: string): string {
  if (!row?.translations) return row?.slug || ''
  try {
    const tr = typeof row.translations === 'string' ? JSON.parse(row.translations) : row.translations
    return tr?.[locale]?.slug || row.slug || ''
  } catch {
    return row?.slug || ''
  }
}

// Find a page by its slug for this team, matching base slug OR the
// translated slug for the current locale.
async function findPageBySlug(ctx: PageLookupCtx, slugValue: string): Promise<any> {
  const { database, pagesSchema, sql, teamId, locale } = ctx
  const byBase = await database
    .select()
    .from(pagesSchema.pagesPages as any)
    .where(
      and(
        eq(pagesSchema.pagesPages.teamId as any, teamId),
        eq(pagesSchema.pagesPages.slug as any, slugValue)
      )
    )
    .limit(1)
    .then((rows: any[]) => rows[0])
  if (byBase) return byBase
  return database
    .select()
    .from(pagesSchema.pagesPages as any)
    .where(
      and(
        eq(pagesSchema.pagesPages.teamId as any, teamId),
        sql`json_extract(${(pagesSchema.pagesPages as any).translations}, '$.' || ${locale} || '.slug') = ${slugValue}`
      )
    )
    .limit(1)
    .then((rows: any[]) => rows[0])
}

// Walk a page's parentId chain, returning ancestor localized slugs
// ordered root → parent (excluding the page itself).
async function resolveAncestorSlugs(ctx: PageLookupCtx, startPage: any): Promise<string[]> {
  const { database, pagesSchema, teamId, locale } = ctx
  const slugs: string[] = []
  const seen = new Set<string>([startPage.id])
  let parentId: string | null = startPage.parentId || null
  while (parentId && !seen.has(parentId)) {
    seen.add(parentId)
    const parent = await database
      .select()
      .from(pagesSchema.pagesPages as any)
      .where(
        and(
          eq(pagesSchema.pagesPages.teamId as any, teamId),
          eq(pagesSchema.pagesPages.id as any, parentId)
        )
      )
      .limit(1)
      .then((rows: any[]) => rows[0])
    if (!parent) break
    const s = rowLocalizedSlug(parent, locale)
    if (s) slugs.unshift(s)
    parentId = parent.parentId || null
  }
  return slugs
}

/** Homepage: fetch first published root page by sort order; 404 when none. */
async function fetchHomepage(ctx: PageLookupCtx): Promise<any> {
  const { database, pagesSchema, teamId } = ctx
  const page = await database
    .select()
    .from(pagesSchema.pagesPages as any)
    .where(
      and(
        eq(pagesSchema.pagesPages.teamId as any, teamId),
        eq(pagesSchema.pagesPages.status as any, 'published'),
        eq(pagesSchema.pagesPages.depth as any, 0) // Root level only
      )
    )
    .orderBy(asc(pagesSchema.pagesPages.order as any))
    .limit(1)
    .then((rows: any[]) => rows[0])

  if (!page) {
    throw createError({
      status: 404,
      statusText: 'No published homepage found'
    })
  }

  return page
}

/**
 * Resolve the URL slug segments to a page row.
 *
 * Returns the page plus:
 * - `fullPath`: the canonical nested slug path of the resolved page
 *   (localized), e.g. "events/summer-fair". Empty for the homepage.
 *   Returned for SEO.
 * - `binderItemId`: non-null only for collection-binder sub-routes.
 */
async function resolvePage(ctx: PageLookupCtx, slugParts: string[]): Promise<{ page: any, fullPath: string, binderItemId: string | null }> {
  const slug = slugParts[0] || ''

  if (!slug) {
    return { page: await fetchHomepage(ctx), fullPath: '', binderItemId: null }
  }

  const lastSeg = slugParts[slugParts.length - 1]!

  // 1) Treat the last segment as a page slug (unique per team).
  let page = await findPageBySlug(ctx, lastSeg)

  if (page) {
    // Nested page: its ancestor slug chain must match the URL prefix,
    // otherwise the URL is non-canonical → 404.
    const ancestorSlugs = await resolveAncestorSlugs(ctx, page)
    const prefix = slugParts.slice(0, -1)
    if (ancestorSlugs.join('/') !== prefix.join('/')) {
      throw createError({ status: 404, statusText: 'Page not found' })
    }
    const fullPath = [...ancestorSlugs, rowLocalizedSlug(page, ctx.locale)].filter(Boolean).join('/')
    return { page, fullPath, binderItemId: null }
  }

  if (slugParts.length >= 2) {
    // 2) Collection-binder sub-route: the segment before the last is the
    // binder page, the last segment is the item id.
    const binderSlug = slugParts[slugParts.length - 2]!
    page = await findPageBySlug(ctx, binderSlug)

    if (!page || page.pageType !== 'pages:collection-binder') {
      throw createError({ status: 404, statusText: 'Page not found' })
    }

    // Binder's own ancestry must match the segments before it.
    const ancestorSlugs = await resolveAncestorSlugs(ctx, page)
    const prefix = slugParts.slice(0, -2)
    if (ancestorSlugs.join('/') !== prefix.join('/')) {
      throw createError({ status: 404, statusText: 'Page not found' })
    }

    const fullPath = [...ancestorSlugs, rowLocalizedSlug(page, ctx.locale)].filter(Boolean).join('/')
    return { page, fullPath, binderItemId: lastSeg }
  }

  throw createError({ status: 404, statusText: 'Page not found' })
}

/**
 * Parse the page's config for scoped-visibility inputs: the stored scope
 * narrowing ({ requiredScope }) and the per-page chrome flags, echoed in the
 * 401 payload so the access gate renders with the same (hidden) chrome as
 * the unlocked page.
 */
function parseScopedPageConfig(page: any): { requiredScope: RequiredScope | null, chrome: PageChrome | undefined } {
  let requiredScope: RequiredScope | null = null
  let chrome: PageChrome | undefined
  try {
    const config = typeof page.config === 'string' ? JSON.parse(page.config) : page.config
    requiredScope = config?.requiredScope || null
    if (config?.hideNav || config?.hideAuthControls) {
      chrome = { hideNav: !!config.hideNav, hideAuthControls: !!config.hideAuthControls }
    }
  } catch {
    // Malformed config — treat as no scope restriction
  }
  return { requiredScope, chrome }
}

/**
 * Extract the page's content blocks (for scope derivation): base `content`
 * first, falling back to any locale's translations content — the embedded
 * blocks are identical across locales.
 */
function extractContentBlocks(page: any): Array<{ type?: string, attrs?: Record<string, unknown> }> {
  const docBlocks = (raw: unknown): Array<{ type?: string, attrs?: Record<string, unknown> }> => {
    try {
      const doc = typeof raw === 'string' ? JSON.parse(raw) : raw
      return Array.isArray((doc as any)?.content) ? (doc as any).content : []
    } catch {
      return []
    }
  }
  let blocks = docBlocks(page.content)
  if (!blocks.length && page.translations) {
    // Block content may live only in the translations (localized
    // editor) — any locale will do, the embedded blocks are identical.
    try {
      const tr = typeof page.translations === 'string' ? JSON.parse(page.translations) : page.translations
      for (const localeData of Object.values(tr || {})) {
        blocks = docBlocks((localeData as any)?.content)
        if (blocks.length) break
      }
    } catch {
      // Malformed translations — no blocks to derive from
    }
  }
  return blocks
}

/**
 * Derive the scope from the page's content blocks at read time
 * (crouton:pages:derive-scope — e.g. crouton-sales answers
 * ('event', eventId) for an embedded eventWorkspaceBlock, so the gate
 * redeems the event's helper PIN directly). The blocks are the source
 * of truth — nothing is stored, so there's no state to drift. A
 * derived scope outranks config.requiredScope; no answer (block
 * removed, event deleted, slug unresolvable) falls back to the
 * stored scope, then to the page's own ('page', pageId) gate.
 */
async function deriveScopeFromBlocks(
  teamId: string,
  blocks: Array<{ type?: string, attrs?: Record<string, unknown> }>,
  requiredScope: RequiredScope | null
): Promise<RequiredScope | null> {
  if (!blocks.length) return requiredScope
  try {
    const derivePayload = { teamId, blocks, result: null as { resourceType: string, resourceId: string, nameRequired?: boolean } | null }
    await useNitroApp().hooks.callHook('crouton:pages:derive-scope', derivePayload)
    if (derivePayload.result) {
      return derivePayload.result
    }
  } catch (err) {
    console.error('[crouton-pages] derive-scope hook failed:', err)
  }
  return requiredScope
}

/**
 * Check whether the request may see a scoped page: a valid scoped-access
 * token for this team (matching the required scope, when one is set), or —
 * as a fallback — a team-member session (admin preview). Any error during
 * validation denies access.
 */
async function hasScopedAccess(event: any, database: any, authSchema: any, teamId: string, requiredScope: RequiredScope | null): Promise<boolean> {
  let allowed = false
  try {
    const { validateScopedTokenFromEvent } = await import('@fyit/crouton-auth/server/utils/scoped-access')
    const access = await validateScopedTokenFromEvent(event)

    if (access && access.organizationId === teamId) {
      allowed = !requiredScope
        || ((!requiredScope.resourceType || access.resourceType === requiredScope.resourceType)
          && (!requiredScope.resourceId || access.resourceId === requiredScope.resourceId))
    }

    if (!allowed) {
      // Fall back to a team-member session (admin preview)
      const { getServerSession } = await import('@fyit/crouton-auth/server/utils/useServerAuth')
      const session = await getServerSession(event)
      if (session?.user) {
        const membership = await database
          .select({ id: authSchema.member.id as any })
          .from(authSchema.member as any)
          .where(
            and(
              eq(authSchema.member.userId as any, session.user.id),
              eq(authSchema.member.organizationId as any, teamId)
            )
          )
          .limit(1)
          .then((rows: any[]) => rows[0])
        allowed = !!membership
      }
    }
  } catch {
    allowed = false
  }
  return allowed
}

/**
 * Enforce `visibility: 'scoped'`: a valid scoped-access token for this team
 * unlocks the page (volunteers/guests — see crouton-auth grants). Team
 * members pass too, so admins can preview. The page's config may narrow the
 * required token via { requiredScope: { resourceType, resourceId? } } —
 * compared as plain strings, pages never learns what the resource is.
 * Throws 401 when access is denied.
 */
async function enforceScopedVisibility(event: any, database: any, authSchema: any, teamId: string, page: any): Promise<void> {
  const parsed = parseScopedPageConfig(page)
  const chrome = parsed.chrome
  let requiredScope = parsed.requiredScope

  const blocks = extractContentBlocks(page)
  requiredScope = await deriveScopeFromBlocks(teamId, blocks, requiredScope)

  const allowed = await hasScopedAccess(event, database, authSchema, teamId, requiredScope)

  if (!allowed) {
    // The data payload lets the client render a PIN gate instead of the
    // member login: it says which resource a credential must be redeemed
    // against — the page's requiredScope, or the page itself (so a grant
    // on ('page', pageId) makes the page self-service PIN-protectable).
    throw createError({
      status: 401,
      statusText: 'Access token required',
      data: {
        reason: 'scoped',
        teamId,
        scope: requiredScope ?? { resourceType: 'page', resourceId: page.id },
        ...(chrome ? { chrome } : {})
      }
    })
  }

  // Prevent ISR/SWR from caching token-gated page responses
  setResponseHeader(event, 'Cache-Control', 'private, no-store')
}

/**
 * Enforce `visibility: 'members' | 'admin'`: requires an authenticated team
 * member; admin pages additionally require the admin or owner role.
 */
async function enforceMemberVisibility(event: any, database: any, authSchema: any, teamId: string, page: any): Promise<void> {
  // Members/admin-only pages require authentication
  try {
    const { getServerSession } = await import('@fyit/crouton-auth/server/utils/useServerAuth')
    const session = await getServerSession(event)

    if (!session?.user) {
      throw createError({
        status: 401,
        statusText: 'Authentication required'
      })
    }

    // Check team membership
    const membership = await database
      .select({ id: authSchema.member.id as any, role: authSchema.member.role as any })
      .from(authSchema.member as any)
      .where(
        and(
          eq(authSchema.member.userId as any, session.user.id),
          eq(authSchema.member.organizationId as any, teamId)
        )
      )
      .limit(1)
      .then((rows: any[]) => rows[0])

    if (!membership) {
      throw createError({
        status: 403,
        statusText: 'Access denied - not a team member'
      })
    }

    // Admin-only pages require admin or owner role
    if (page.visibility === 'admin' && membership.role !== 'admin' && membership.role !== 'owner') {
      throw createError({
        status: 403,
        statusText: 'Access denied - admin access required'
      })
    }

    // Prevent ISR/SWR from caching restricted page responses
    setResponseHeader(event, 'Cache-Control', 'private, no-store')
  } catch (authError: any) {
    if (authError.statusCode) throw authError
    throw createError({
      status: 401,
      statusText: 'Authentication required'
    })
  }
}

/** Resolve translations - merge translated fields over base values (mutates the row). */
function applyPageTranslations(page: any, locale: string): void {
  if (!page.translations) return
  try {
    const translations = typeof page.translations === 'string'
      ? JSON.parse(page.translations)
      : page.translations

    const localeTranslations = translations[locale] || translations['en'] || Object.values(translations)[0]

    if (localeTranslations && typeof localeTranslations === 'object') {
      const originalSlug = page.slug
      for (const [key, value] of Object.entries(localeTranslations)) {
        if (value !== null && value !== undefined) {
          page[key] = value
        }
      }
      page.baseSlug = originalSlug
    }
  } catch (e) {
    console.error('[pages] Translation parsing error:', e)
  }
}

export default defineEventHandler(async (event) => {
  const teamParam = getRouterParam(event, 'id')
  const slugParam = getRouterParam(event, 'slug')

  if (!teamParam) {
    throw createError({
      status: 400,
      statusText: 'Team ID or slug is required'
    })
  }

  // Handle empty slug or _home (homepage)
  const rawSlug = (!slugParam || slugParam === '_home') ? '' : slugParam

  // Split into nested path segments. Pages are addressed hierarchically
  // (/{parent}/{child}); a collection-binder item is the special case where the
  // last segment isn't itself a page slug (see lookup below). Slugs are unique
  // per team, so the last segment alone identifies the page; the preceding
  // segments must match its ancestor chain for the URL to be canonical.
  const slugParts = rawSlug ? rawSlug.split('/').filter(Boolean) : []

  // Get locale from query parameter (for translated slug lookup)
  const locale = getQuery(event).locale as string || 'en'

  try {
    const database = useDB()

    // Resolve team
    const authSchema = await import('@fyit/crouton-auth/server/database/schema/auth')
    const team = await resolveTeam(database, authSchema, teamParam)

    // Try to get page from pagesPages table
    try {
      const pagesSchema = await import('~~/layers/pages/collections/pages/server/database/schema')
      const { sql } = await import('drizzle-orm')

      const ctx: PageLookupCtx = { database, pagesSchema, sql, teamId: team.id, locale }

      // binderItemId is non-null only for binder sub-routes.
      const { page, fullPath, binderItemId } = await resolvePage(ctx, slugParts)

      // Check page status
      if (page.status !== 'published') {
        throw createError({
          status: 404,
          statusText: 'Page not found'
        })
      }

      // Check visibility
      if (page.visibility === 'hidden') {
        // Hidden pages require direct link - allow access
      } else if (page.visibility === 'scoped') {
        await enforceScopedVisibility(event, database, authSchema, team.id, page)
      } else if (page.visibility === 'members' || page.visibility === 'admin') {
        await enforceMemberVisibility(event, database, authSchema, team.id, page)
      }

      applyPageTranslations(page, locale)

      // For binder sub-routes: inject binderItemId into config
      if (binderItemId) {
        const existingConfig = page.config
          ? (typeof page.config === 'string' ? JSON.parse(page.config) : page.config)
          : {}
        page.config = { ...existingConfig, binderItemId }
      }

      return {
        data: page,
        meta: {
          teamId: team.id,
          teamSlug: team.slug,
          locale,
          // Canonical nested slug path (localized), e.g. "events/summer-fair".
          // Empty for the homepage. Consumers build the URL as
          // /{team?}/{locale}/{fullPath}.
          fullPath,
          translations: page.translations
        }
      }
    } catch (error: any) {
      if (error.statusCode) throw error
      throw createError({
        status: 404,
        statusText: 'Page not found'
      })
    }
  } catch (error: any) {
    if (error.statusCode) throw error
    console.error('[crouton-pages] Error fetching page:', error)
    throw createError({
      status: 500,
      statusText: 'Failed to fetch page'
    })
  }
})
