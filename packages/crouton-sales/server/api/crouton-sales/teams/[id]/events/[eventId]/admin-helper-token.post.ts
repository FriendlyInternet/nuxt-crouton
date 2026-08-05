/**
 * Admin POS token — issues a helper scoped-access token for a logged-in
 * team member, without requiring the event PIN. Lets admins open the POS
 * directly (the order endpoints stay helper-token-authenticated, so order
 * attribution via displayName keeps working).
 */
import { createScopedToken } from '@fyit/crouton-auth/server/utils/scoped-access'
import { requireTeamEvent } from '../../../../../../utils/team-event'

export default defineEventHandler(async (event) => {
  const { team, user, eventId } = await requireTeamEvent(event)

  const helperName = user.name || user.email || 'Admin'

  const { token, expiresAt } = await createScopedToken({
    organizationId: team.id,
    resourceType: 'event',
    resourceId: eventId,
    displayName: helperName,
    role: 'helper'
  })

  return {
    token,
    helperName,
    teamId: team.id,
    eventId,
    role: 'helper',
    expiresAt: expiresAt.toISOString()
  }
})
