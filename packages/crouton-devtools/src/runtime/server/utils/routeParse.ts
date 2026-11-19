import type { Operation } from './operationStore'

/**
 * Extract collection name from API path
 */
export function extractCollectionName(path: string): string {
  const match = path.match(/\/api\/crouton-collection\/([^/?]+)/)
  return match?.[1] || 'unknown'
}

/**
 * Extract item ID from API path for get/update/delete operations
 * Path format: /api/crouton-collection/{collection}/{itemId}
 */
export function extractItemId(path: string): string | undefined {
  // Match patterns like /api/crouton-collection/users/abc123
  // where abc123 is the item ID (not a query param or search suffix)
  const match = path.match(/\/api\/crouton-collection\/[^/]+\/([a-zA-Z0-9_-]+)(?:\?|$)/)
  const itemId = match?.[1]

  // Exclude known non-ID paths
  if (itemId === 'search' || itemId === 'export') {
    return undefined
  }

  return itemId
}

/**
 * Extract a human-readable label from a non-collection route path.
 * Strips the known prefix, UUIDs, and team IDs; returns the first meaningful segment.
 * e.g. '/api/crouton-bookings/teams/abc123/customer-bookings' → 'customer-bookings'
 */
export function extractRouteLabel(path: string, prefix: string): string {
  const stripped = path.slice(prefix.length).replace(/\?.*$/, '')
  const segments = stripped.split('/').filter(Boolean)
  // Skip common path segments that are not meaningful labels
  const SKIP = new Set(['teams', 'api'])
  const meaningful = segments.filter(s => !SKIP.has(s) && !/^[a-f0-9-]{8,}$/i.test(s))
  return meaningful[0] ?? segments[0] ?? 'unknown'
}

/**
 * Detect operation type from HTTP method and path
 */
export function detectOperation(method: string, path: string): Operation['operation'] {
  const normalizedMethod = method.toUpperCase()

  if (normalizedMethod === 'GET' && path.includes('/search')) {
    return 'list'
  }

  if (normalizedMethod === 'GET' && /\/[a-z0-9-]+$/i.test(path)) {
    return 'get'
  }

  if (normalizedMethod === 'GET') {
    return 'list'
  }

  if (normalizedMethod === 'POST') {
    return 'create'
  }

  if (normalizedMethod === 'PATCH' || normalizedMethod === 'PUT') {
    return 'update'
  }

  if (normalizedMethod === 'DELETE') {
    return 'delete'
  }

  return 'list'
}

/**
 * #3255: map each registered collection's `apiPath` to its collection name, from
 * `croutonCollections` in app config (`{ [key]: { name?, apiPath? } }`).
 */
export function buildApiPathIndex(collections: Record<string, unknown>): Map<string, string> {
  const index = new Map<string, string>()
  for (const [key, config] of Object.entries(collections || {})) {
    const cfg = config as { name?: unknown, apiPath?: unknown } | null
    if (cfg && typeof cfg === 'object' && typeof cfg.apiPath === 'string') {
      index.set(cfg.apiPath, typeof cfg.name === 'string' ? cfg.name : key)
    }
  }
  return index
}

// Generated routes after /api/teams/<teamId>/<apiPath>: '', /<id>, /reorder, /<id>/move
const TEAM_COLLECTION_ROUTE = /^\/api\/teams\/[^/]+\/([^/]+)(?:\/([^/]+)(\/move)?)?\/?$/

const WRITE_OPERATIONS: Record<string, Operation['operation']> = {
  POST: 'create',
  PATCH: 'update',
  PUT: 'update',
  DELETE: 'delete'
}

/**
 * #3255: recognise a generated collection route, `/api/teams/<teamId>/<apiPath>[/<itemId>[/move]]`.
 * Returns undefined when the path isn't one, or `<apiPath>` isn't a registered collection.
 */
export function parseTeamCollectionRoute(
  method: string,
  path: string,
  index: Map<string, string>
): { collection: string, operation: Operation['operation'], itemId?: string } | undefined {
  const [, apiPath = '', segment] = path.replace(/\?.*$/, '').match(TEAM_COLLECTION_ROUTE) ?? []
  const collection = index.get(apiPath)
  if (!collection) return undefined

  const itemId = segment === 'reorder' ? undefined : segment
  const operation = WRITE_OPERATIONS[method.toUpperCase()] ?? (itemId ? 'get' : 'list')
  return { collection, operation, itemId }
}

export interface TrackedPrefix { prefix: string, routeGroup: string }

/**
 * Decide what the operation tracker records for a request, or undefined to skip it.
 * Generated team routes first (#3255), then the tracked prefixes (`/api/crouton-collection/`
 * plus each package's `croutonApps.*.apiRoutes`).
 */
export function classifyRequest(
  method: string,
  path: string,
  prefixes: TrackedPrefix[],
  index: Map<string, string>
): { collection: string, operation: Operation['operation'], itemId?: string, routeGroup: string } | undefined {
  const teamRoute = parseTeamCollectionRoute(method, path, index)
  if (teamRoute) return { ...teamRoute, routeGroup: 'collection' }

  const matched = prefixes.find(({ prefix }) => path.startsWith(prefix))
  if (!matched) return undefined

  const isCollection = matched.routeGroup === 'collection'
  return {
    // Collection routes name their collection; other routes use the first meaningful segment
    collection: isCollection ? extractCollectionName(path) : extractRouteLabel(path, matched.prefix),
    operation: detectOperation(method, path),
    itemId: isCollection ? extractItemId(path) : undefined,
    routeGroup: matched.routeGroup
  }
}
