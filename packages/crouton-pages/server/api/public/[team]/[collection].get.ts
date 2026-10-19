/**
 * Public Collection List Endpoint
 *
 * Returns items from a collection that is exposed via a published
 * collection-binder page with visibility: 'public'.
 *
 * No authentication required — data is cached with SWR for 5 minutes.
 *
 * GET /api/public/[team]/[collection]
 *
 * Query params:
 * - sort: Field name to sort by (default: createdAt)
 * - order: 'asc' or 'desc' (default: desc)
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

  if (!teamParam || !collectionParam) {
    throw createError({ status: 400, statusText: 'Missing required parameters' })
  }

  const query = getQuery(event)
  const sortField = (query.sort as string) || 'createdAt'
  const sortOrder = (query.order as string) === 'asc' ? 'asc' : 'desc'

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
    const pagesSchema = await import('../../../../collections/pages/server/database/schema')

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

    // ── 3. Get items from the query registry ──
    // queryRegistry is auto-imported by Nitro from the app's server/utils/
    // Use globalThis fallback for apps that haven't generated a registry yet
    // Package-owned collections (#2309) + the app's generated registry, app winning on a clash
    const registry = resolveQueryRegistry(typeof queryRegistry !== 'undefined' ? queryRegistry : null)

    const collectionQueries = registry[collectionParam]
    if (!collectionQueries?.getAll) {
      throw createError({ status: 404, statusText: 'Not found' })
    }

    // ── 4. Fetch all items for this team ──
    const getAllFn = await collectionQueries.getAll()
    const items = await getAllFn(team.id)

    if (!Array.isArray(items)) {
      throw createError({ status: 404, statusText: 'Not found' })
    }

    // ── 5. Filter to published items (if collection has a status field) ──
    let filtered = items
    if (filtered.length > 0 && 'status' in filtered[0]) {
      filtered = filtered.filter((item: any) => item.status === 'published')
    }

    // ── 6. Sort ──
    filtered.sort((a: any, b: any) => {
      const aVal = a[sortField]
      const bVal = b[sortField]
      if (aVal == null && bVal == null) return 0
      if (aVal == null) return 1
      if (bVal == null) return -1
      if (aVal < bVal) return sortOrder === 'asc' ? -1 : 1
      if (aVal > bVal) return sortOrder === 'asc' ? 1 : -1
      return 0
    })

    // ── 7. Strip internal fields ──
    const data = filtered.map((item: Record<string, unknown>) => stripInternalFields(item))

    return {
      data,
      meta: {
        teamId: team.id,
        teamSlug: team.slug,
        collection: collectionParam,
        total: data.length
      }
    }
  } catch (error: any) {
    if (error.statusCode) throw error
    console.error('[crouton-pages] Public collection list error:', error)
    throw createError({ status: 500, statusText: 'Internal server error' })
  }
}, {
  swr: true,
  maxAge: 300,
  name: 'crouton-public-collection-list',
  getKey: (event) => {
    const team = getRouterParam(event, 'team') || 'unknown'
    const collection = getRouterParam(event, 'collection') || 'unknown'
    const query = getQuery(event)
    const sort = (query.sort as string) || 'createdAt'
    const order = (query.order as string) || 'desc'
    return `${team}:${collection}:sort=${sort}:order=${order}`
  }
})
