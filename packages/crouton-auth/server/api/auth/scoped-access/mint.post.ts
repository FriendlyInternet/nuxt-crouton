/**
 * Mint a Scoped Access Token from a Session
 *
 * POST /api/auth/scoped-access/mint
 *
 * Delegation: an authenticated team member mints a scoped token directly —
 * no grant or secret involved. Generalizes the "admin gets a helper token
 * without typing the PIN" flow so any domain can use it.
 */
import { createScopedToken } from '../../../utils/scoped-access'
import { getTeamById, getTeamBySlug, getMembership } from '../../../utils/team'
import { requireServerSession } from '../../../utils/useServerAuth'
import { can } from '../../../utils/permissions'

export default defineEventHandler(async (event) => {
  const session = await requireServerSession(event)

  const body = await readBody<{
    teamId?: string
    resourceType?: string
    resourceId?: string
    role?: string
    displayName?: string
    tokenTtl?: number
  }>(event)

  const { teamId, resourceType, resourceId, role, displayName, tokenTtl } = body || {}

  if (!teamId || !resourceType || !resourceId) {
    throw createError({
      status: 400,
      statusText: 'teamId, resourceType and resourceId are required'
    })
  }

  const team = await getTeamById(event, teamId) ?? await getTeamBySlug(event, teamId)
  if (!team) {
    throw createError({ status: 404, statusText: 'Team not found' })
  }

  const membership = await getMembership(event, team.id, session.user.id)
  if (!membership) {
    throw createError({ status: 403, statusText: 'Not a team member' })
  }

  // Minting a delegation token is an administrative act: it stamps a trusted
  // resource `role` onto the token. Restrict to `team:manage` (owner/admin by
  // default) so a plain member cannot mint a token carrying an elevated role.
  if (!(await can(team.id, session.user.id, 'team:manage', event))) {
    throw createError({ status: 403, statusText: 'Only team admins can mint scoped tokens' })
  }

  const { token, expiresAt } = await createScopedToken({
    organizationId: team.id,
    resourceType,
    resourceId,
    displayName: displayName || session.user.name || 'Team member',
    role: role || 'guest',
    expiresIn: tokenTtl
  })

  setCookie(event, 'scoped-access-token', token, {
    path: '/',
    expires: expiresAt,
    sameSite: 'lax',
    httpOnly: true,
    secure: !import.meta.dev
  })

  return {
    token,
    displayName: displayName || session.user.name || 'Team member',
    role: role || 'guest',
    resourceType,
    resourceId,
    teamId: team.id,
    expiresAt: expiresAt.toISOString()
  }
})
