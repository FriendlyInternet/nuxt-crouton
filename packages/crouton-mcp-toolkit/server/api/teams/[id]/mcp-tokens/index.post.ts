/**
 * POST /api/teams/:id/mcp-tokens
 *
 * Create an MCP access token for the team.
 * Requires session auth (must be a team member).
 *
 * Body: { displayName?: string, expiresInDays?: number, scope?: 'pages' }
 * Returns: { token, teamId, displayName, expiresAt } (+ `url` for scope 'pages')
 *
 * `scope: 'pages'` (#3982) mints a token for the live page tools at /mcp/pages:
 * team ADMINS only (as for the pages editor), `resourceId: 'mcp-pages'`, and the
 * response carries the URL to paste into the Claude app. Answers 404 when the app
 * does not serve the pages handler (`croutonMcpToolkit.pages` off).
 */
export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const scope = body?.scope === 'pages' ? 'pages' : 'general'

  if (scope === 'pages') {
    const runtime = useRuntimeConfig().croutonMcpToolkit as { pages?: boolean } | undefined
    if (runtime?.pages !== true) {
      throw createError({ status: 404, statusText: 'pages tools are not enabled in this app' })
    }
  }

  const teamAuth = await import('@fyit/crouton-auth/server/utils/team')
  const { team } = scope === 'pages'
    ? await teamAuth.requireTeamAdmin(event)
    : await teamAuth.resolveTeamAndCheckMembership(event)

  const displayName = body?.displayName || (scope === 'pages' ? 'Claude pages' : 'MCP Client')
  const expiresInDays = body?.expiresInDays || 90

  const { createScopedToken } = await import('@fyit/crouton-auth/server/utils/scoped-access')
  const { token, expiresAt } = await createScopedToken({
    organizationId: team.id,
    resourceType: 'mcp',
    resourceId: scope === 'pages' ? 'mcp-pages' : 'mcp-toolkit',
    displayName,
    role: scope === 'pages' ? 'admin' : 'member',
    expiresIn: expiresInDays * 24 * 60 * 60 * 1000
  })

  return {
    token,
    teamId: team.id,
    displayName,
    expiresAt: expiresAt.toISOString(),
    ...(scope === 'pages'
      ? { url: `${getRequestURL(event).origin}/mcp/pages?token=${encodeURIComponent(token)}` }
      : {})
  }
})
