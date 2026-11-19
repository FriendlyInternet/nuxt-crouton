/**
 * MCP sign-in helpers (#4096): stale-client cleanup on each registration.
 *
 * Registration (DCR) is open without login (Claude needs it), so anyone can
 * create client rows. On each registration we delete anonymous clients older
 * than 24 hours that were never used: no consent, no access token, no refresh
 * token. A client whose consent was revoked still holds tokens (Révoquer only
 * deletes the consent row) and is left alone. No cron needed.
 */
import { createAuthMiddleware } from 'better-auth/api'

/** Root paths the Better Auth plugins' own `onRequest` answers. */
const DISCOVERY_HANDLER_PATHS = new Set([
  '/.well-known/oauth-authorization-server/api/auth',
  '/.well-known/oauth-protected-resource',
  '/.well-known/oauth-protected-resource/mcp'
])
const DISCOVERY_METADATA_PATH = '/.well-known/oauth-authorization-server'

/**
 * Which discovery answer a root path gets (used by the
 * `mcp-oauth-discovery` server middleware), or null when it is not ours.
 */
export function mcpDiscoveryRoute(pathname: string): 'metadata' | 'handler' | null {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname
  if (path === DISCOVERY_METADATA_PATH) return 'metadata'
  if (DISCOVERY_HANDLER_PATHS.has(path)) return 'handler'
  return null
}

export const STALE_CLIENT_AGE_MS = 24 * 60 * 60 * 1000
const BATCH_LIMIT = 100

type Where = { field: string, value: unknown, operator?: string }
interface CleanupAdapter {
  findMany: <T>(args: { model: string, where?: Where[], limit?: number }) => Promise<T[]>
  delete: (args: { model: string, where: Where[] }) => Promise<void>
}

/**
 * Delete anonymous, never-used OAuth clients older than 24 hours.
 * Returns the public client ids it deleted.
 */
export async function cleanupStaleMcpClients(adapter: CleanupAdapter, now: Date): Promise<string[]> {
  const cutoff = new Date(now.getTime() - STALE_CLIENT_AGE_MS)
  const stale = await adapter.findMany<{ clientId: string, userId?: string | null }>({
    model: 'oauthClient',
    where: [
      { field: 'createdAt', operator: 'lt', value: cutoff },
      { field: 'userId', value: null }
    ],
    limit: BATCH_LIMIT
  })
  const clientIds = stale.filter(c => !c.userId).map(c => c.clientId)
  if (!clientIds.length) return []

  // A client that holds a consent or any token has been used — keep it.
  const inUse = new Set<string>()
  for (const model of ['oauthConsent', 'oauthAccessToken', 'oauthRefreshToken']) {
    const rows = await adapter.findMany<{ clientId: string }>({
      model,
      where: [{ field: 'clientId', operator: 'in', value: clientIds }]
    })
    for (const row of rows) inUse.add(row.clientId)
  }

  const deleted: string[] = []
  for (const clientId of clientIds) {
    if (inUse.has(clientId)) continue
    try {
      await adapter.delete({ model: 'oauthClient', where: [{ field: 'clientId', value: clientId }] })
      deleted.push(clientId)
    } catch (error) {
      console.error('[crouton/auth] could not delete stale OAuth client', clientId, error)
    }
  }
  return deleted
}

/**
 * Better Auth plugin: run the cleanup after each `/oauth2/register`.
 * A cleanup error never fails the registration.
 */
export function mcpClientCleanup() {
  return {
    id: 'crouton-mcp-client-cleanup',
    hooks: {
      after: [{
        matcher: (ctx: { path?: string }) => ctx.path === '/oauth2/register',
        handler: createAuthMiddleware(async (ctx) => {
          try {
            await cleanupStaleMcpClients(ctx.context.adapter as unknown as CleanupAdapter, new Date())
          } catch (error) {
            console.error('[crouton/auth] OAuth client cleanup failed', error)
          }
        })
      }]
    }
  }
}
