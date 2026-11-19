/**
 * OAuth discovery at the app root for MCP clients (#4096)
 *
 * Better Auth only runs behind `/api/auth/**`, so the root `/.well-known/*`
 * paths an MCP client (Claude, ChatGPT, …) looks up need their own answer.
 * @nuxtjs/mcp-toolkit registers 404 handlers on the same paths ("OAuth is
 * not configured"); a server middleware runs before any route handler, so
 * with `croutonAuth.mcpOAuth` on we answer here and the toolkit's 404 never
 * runs. With the flag off this does nothing (the toolkit's 404 stays).
 * `openid-configuration` is not served.
 *
 * Auto-registered: crouton-auth is a Nuxt layer, so Nitro loads every file
 * in its `server/middleware/` (like `team-context.ts`).
 */
import type { H3Event } from 'h3'
import { oauthProviderAuthServerMetadata } from '@better-auth/oauth-provider'
import type { CroutonAuthConfig } from '../../types/config'
import { useServerAuth } from '../utils/useServerAuth'
import { mcpDiscoveryRoute } from '../lib/mcp-oauth'

// Complexity: thin handler: route match + flag guard; the route logic is unit-tested (mcpDiscoveryRoute) and the handler by e2e/mcp-oauth.smoke.spec.ts T2/T3
// fallow-ignore-next-line complexity
export default defineEventHandler(async (event: H3Event) => {
  const route = mcpDiscoveryRoute(getRequestURL(event).pathname)
  if (!route) return
  const config = useRuntimeConfig().public.crouton?.auth as CroutonAuthConfig | undefined
  if (!config?.mcpOAuth) return

  const auth = useServerAuth(event)
  const request = toWebRequest(event)
  if (route === 'metadata') {
    return oauthProviderAuthServerMetadata(auth as unknown as Parameters<typeof oauthProviderAuthServerMetadata>[0])(request)
  }
  return auth.handler(request)
})
