import type { H3Event } from 'h3'

/**
 * Authenticate an MCP request and verify team membership.
 *
 * Tries two auth strategies in order:
 * 1. Bearer token (scoped access token) — for headless MCP clients (Claude Desktop, Cursor, etc.)
 * 2. Session cookie — for browser-based MCP access
 *
 * Scoped tokens are team-scoped: the token's organizationId must match the requested teamId.
 */
export async function requireMcpAuth(event: H3Event, teamId: string) {
  // 1. Try bearer token (scoped access)
  const authHeader = getHeader(event, 'authorization')
  if (authHeader?.startsWith('Bearer ')) {
    const { validateScopedToken } = await import('@fyit/crouton-auth/server/utils/scoped-access')
    const token = authHeader.slice(7)
    const result = await validateScopedToken(token)

    if (!result) {
      throw createError({ status: 401, statusText: 'Invalid or expired MCP token' })
    }

    if (result.resourceType !== 'mcp') {
      throw createError({ status: 403, statusText: 'Token is not an MCP access token' })
    }

    // A pages token (`mcp-pages`, #3982) only drives /mcp/pages — never the generic tools
    if (result.resourceId !== 'mcp-toolkit') {
      throw createError({ status: 403, statusText: 'Token is not a general MCP token' })
    }

    if (result.organizationId !== teamId) {
      throw createError({ status: 403, statusText: 'Token does not grant access to this team' })
    }

    return result
  }

  // 2. Fall back to session cookie
  const { resolveTeamAndCheckMembership } = await import('@fyit/crouton-auth/server/utils/team')
  event.context.params = event.context.params || {}
  event.context.params.id = teamId

  return await resolveTeamAndCheckMembership(event)
}
