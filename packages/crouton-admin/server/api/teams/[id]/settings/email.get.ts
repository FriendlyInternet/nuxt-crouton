/**
 * GET /api/teams/[id]/settings/email
 *
 * Get team email template overrides.
 * Requires the `team:manage` action (owner/admin by default).
 */
import { requireCan } from '@fyit/crouton-auth/server/utils/team-auth'
import { useDB, eq } from '@fyit/crouton-auth/server/utils/database'
import { teamSettings } from '@fyit/crouton-auth/server/database/schema/auth'

export default defineEventHandler(async (event) => {
  const { team } = await requireCan(event, 'team:manage')

  const db = useDB()
  const settings = await db
    .select({ emailSettings: teamSettings.emailSettings })
    .from(teamSettings)
    .where(eq(teamSettings.teamId, team.id))
    .limit(1)

  return settings[0]?.emailSettings ?? {}
})
