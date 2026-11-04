/**
 * In-memory redirect cache for fast path matching.
 *
 * Loads all active redirects from the database into a Map<`${teamId}:${fromPath}`, { toPath, statusCode }>.
 * Invalidated when redirects are created, updated, or deleted via the API.
 */

interface CachedRedirect {
  toPath: string
  statusCode: string
}

import { isSafeRedirectPath } from './redirectValidation'

/** Redirects are scoped to the team that owns them. */
export function redirectKey(teamId: string, fromPath: string): string {
  return `${teamId}:${fromPath}`
}

/** Look up a redirect for one team; no team means no redirect. */
export function findRedirect(
  map: Map<string, CachedRedirect>,
  teamId: string | null | undefined,
  fromPath: string
): CachedRedirect | undefined {
  if (!teamId) return undefined
  return map.get(redirectKey(teamId, fromPath))
}

let redirectMap: Map<string, CachedRedirect> | null = null
let loading: Promise<Map<string, CachedRedirect>> | null = null

/**
 * Get the redirect map, loading from DB if not cached.
 * Uses a loading promise to prevent thundering herd on concurrent requests.
 */
export async function getRedirectMap(): Promise<Map<string, CachedRedirect>> {
  if (redirectMap) {
    return redirectMap
  }

  // Prevent concurrent loads
  if (loading) {
    return loading
  }

  loading = loadRedirects()
  try {
    redirectMap = await loading
    return redirectMap
  } finally {
    loading = null
  }
}

async function loadRedirects(): Promise<Map<string, CachedRedirect>> {
  const map = new Map<string, CachedRedirect>()

  try {
    const { getActiveCroutonRedirects } = await import('../database/queries/redirects')
    const rows = await getActiveCroutonRedirects()

    for (const row of rows) {
      // First redirect for a path wins (shouldn't have duplicates due to unique index)
      const key = redirectKey(row.teamId, row.fromPath)
      if (!map.has(key) && isSafeRedirectPath(row.toPath)) {
        map.set(key, {
          toPath: row.toPath,
          statusCode: row.statusCode
        })
      }
    }
  } catch (error) {
    const msg = (error as Error).message || ''
    // Silently ignore "table not found" — normal for apps that haven't added the migration yet
    if (!msg.includes('no such table') && !msg.includes('crouton_redirects')) {
      console.warn('[crouton:redirects] Could not load redirects:', msg)
    }
  }

  return map
}

/**
 * Invalidate the redirect cache. Called after create/update/delete operations.
 */
export function invalidateRedirectCache(): void {
  redirectMap = null
}
