/**
 * Revoke a claimed device (#1662) — works for tills and print routers alike.
 *
 * Deactivates the grant rather than deleting it, so the row remains as an
 * audit trail of what was once claimed. The lookup is team-scoped: revoking a
 * device belonging to another team is indistinguishable from revoking one that
 * does not exist (404), so this is not a cross-team probe.
 */
import { resolveTeamAndCheckMembership } from '@fyit/crouton-auth/server/utils/team'
import { revokeTeamDevice } from '../../../../utils/device-pairing'

export default defineEventHandler(async (event) => {
  const { team } = await resolveTeamAndCheckMembership(event)

  const deviceId = getRouterParam(event, 'deviceId')
  if (!deviceId) {
    throw createError({ status: 400, statusText: 'Device id is required' })
  }

  const revoked = await revokeTeamDevice(team.id, decodeURIComponent(deviceId))
  if (!revoked) {
    throw createError({ status: 404, statusText: 'Device not found' })
  }

  return { revoked: true, deviceId }
})
