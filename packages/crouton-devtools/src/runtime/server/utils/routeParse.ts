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
