/**
 * POST /api/teams/:id/mcp-tokens
 *
 * Create an MCP access token for the team (the generic collection tools).
 * Requires session auth (must be a team member).
 *
 * Body: { displayName?: string, expiresInDays?: number }
 * Returns: { token, teamId, displayName, expiresAt }
 *
 * The live page tools take no token from here: Claude signs in at `<origin>/mcp`
 * (crouton-auth's MCP OAuth, #4097).
 */
export default defineEventHandler(async (event) => {
  const body = await readBody(event)

  const teamAuth = await import('@fyit/crouton-auth/server/utils/team')
  const { team } = await teamAuth.resolveTeamAndCheckMembership(event)

  const displayName = body?.displayName || 'MCP Client'
  const expiresInDays = body?.expiresInDays || 90

  const { createScopedToken } = await import('@fyit/crouton-auth/server/utils/scoped-access')
  const { token, expiresAt } = await createScopedToken({
    organizationId: team.id,
    resourceType: 'mcp',
    resourceId: 'mcp-toolkit',
    displayName,
    role: 'member',
    expiresIn: expiresInDays * 24 * 60 * 60 * 1000
  })

  return {
    token,
    teamId: team.id,
    displayName,
    expiresAt: expiresAt.toISOString()
  }
})
