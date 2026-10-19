/**
 * Public Collection Item Detail Endpoint
 *
 * Returns a single item from a collection that is exposed via a published
 * collection-binder page with visibility: 'public'.
 *
 * No authentication required — data is cached with SWR for 5 minutes.
 *
 * GET /api/public/[team]/[collection]/[itemId]
 */
import { eq, and, or } from 'drizzle-orm'
import { resolveQueryRegistry } from '@fyit/crouton-core/shared/utils/query-registry'

// Optionally auto-imported by Nitro from the consuming app's generated
// server/utils/crouton-query-registry.ts. Apps that haven't generated a
// registry yet won't have it, so usage is guarded with `typeof`. Declared
// (module-scoped) so the guard type-checks without assuming the import exists.
declare const queryRegistry: Record<string, unknown> | undefined

/**
 * Strip internal/sensitive fields from a collection item.
 */
function stripInternalFields(item: Record<string, unknown>): Record<string, unknown> {
  const stripped = { ...item }
  delete stripped.createdBy
  delete stripped.updatedBy
  delete stripped.createdByUser
  delete stripped.updatedByUser
  return stripped
}

export default defineCachedEventHandler(async (event) => {
  const teamParam = getRouterParam(event, 'team')
  const collectionParam = getRouterParam(event, 'collection')
  const itemId = getRouterParam(event, 'itemId')

  if (!teamParam || !collectionParam || !itemId) {
    throw createError({ status: 400, statusText: 'Missing required parameters' })
  }

  try {
    const database = useDB()

    // ── 1. Resolve team by ID or slug (no auth required) ──
    const authSchema = await import('@fyit/crouton-auth/server/database/schema/auth')

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
      throw createError({ status: 404, statusText: 'Not found' })
    }

    // ── 2. Find a published, public collection-binder page for this collection ──
    const pagesSchema = await import('../../../../../collections/pages/server/database/schema')

    const binderPages = await database
      .select()
      .from(pagesSchema.pagesPages as any)
      .where(
        and(
          eq(pagesSchema.pagesPages.teamId as any, team.id),
          eq(pagesSchema.pagesPages.pageType as any, 'pages:collection-binder'),
          eq(pagesSchema.pagesPages.status as any, 'published'),
          eq(pagesSchema.pagesPages.visibility as any, 'public')
        )
      )

    // Find one whose config matches the requested collection
    const matchingBinder = binderPages.find((page: any) => {
      try {
        const config = typeof page.config === 'string' ? JSON.parse(page.config) : page.config
        return config?.collection === collectionParam
      } catch {
        return false
      }
    })

    if (!matchingBinder) {
      throw createError({ status: 404, statusText: 'Not found' })
    }

    // ── 3. Get item from the query registry ──
    // queryRegistry is auto-imported by Nitro from the app's server/utils/
    // Package-owned collections (#2309) + the app's generated registry, app winning on a clash
    const registry = resolveQueryRegistry(typeof queryRegistry !== 'undefined' ? queryRegistry : null)

    const collectionQueries = registry[collectionParam]
    if (!collectionQueries?.getByIds) {
      throw createError({ status: 404, statusText: 'Not found' })
    }

    // ── 4. Fetch item by ID ──
    const getByIdsFn = await collectionQueries.getByIds()
    const items = await getByIdsFn(team.id, [itemId])

    if (!Array.isArray(items) || items.length === 0) {
      throw createError({ status: 404, statusText: 'Not found' })
    }

    const item = items[0]

    // ── 5. Check published status (if collection has a status field) ──
    if ('status' in item && item.status !== 'published') {
      throw createError({ status: 404, statusText: 'Not found' })
    }

    // ── 6. Strip internal fields and return ──
    const data = stripInternalFields(item as Record<string, unknown>)

    return {
      data,
      meta: {
        teamId: team.id,
        teamSlug: team.slug,
        collection: collectionParam
      }
    }
  } catch (error: any) {
    if (error.statusCode) throw error
    console.error('[crouton-pages] Public collection item error:', error)
    throw createError({ status: 500, statusText: 'Internal server error' })
  }
}, {
  swr: true,
  maxAge: 300,
  name: 'crouton-public-collection-item',
  getKey: (event) => {
    const team = getRouterParam(event, 'team') || 'unknown'
    const collection = getRouterParam(event, 'collection') || 'unknown'
    const itemId = getRouterParam(event, 'itemId') || 'unknown'
    return `${team}:${collection}:${itemId}`
  }
})
