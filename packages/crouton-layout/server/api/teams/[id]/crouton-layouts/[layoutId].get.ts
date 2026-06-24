import { eq, and } from 'drizzle-orm'
import { resolveTeamAndCheckMembership } from '@fyit/crouton-auth/server/utils/team'
import { layoutConfigs } from '../../../../database/schema/layoutConfigs'

/**
 * GET a saved layout tree by id, scoped to the caller's team (Sprint 0 spike, #713).
 * Returns the row (incl. `tree`) or null.
 */
export default defineEventHandler(async (event) => {
  const { team } = await resolveTeamAndCheckMembership(event)
  const db = useDB()
  const layoutId = getRouterParam(event, 'layoutId')!

  const [row] = await db
    .select()
    .from(layoutConfigs)
    .where(and(eq(layoutConfigs.id, layoutId), eq(layoutConfigs.teamId, team.id)))
    .limit(1)

  return row ?? null
})
