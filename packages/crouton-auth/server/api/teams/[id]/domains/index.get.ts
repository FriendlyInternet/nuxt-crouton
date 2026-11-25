/**
 * GET /api/teams/[id]/domains
 *
 * List all custom domains for a team/organization.
 * Requires the `team:domains` action (owner/admin by default).
 */
import { requireCan } from '../../../../utils/permissions'
import { useDB, tables, eq } from '../../../../utils/database'

export default defineEventHandler(async (event) => {
  const { team } = await requireCan(event, 'team:domains')

  const db = useDB()
  const domains = await db
    .select()
    .from(tables.domain)
    .where(eq(tables.domain.organizationId, team.id))

  return domains
})
