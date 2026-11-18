/**
 * POST /api/teams/[id]/domains/[domainId]/set-primary
 *
 * Set a domain as the primary domain for a team/organization.
 * Only verified domains can be set as primary.
 * Requires the `team:domains` action (owner/admin by default).
 */
import { requireCan } from '../../../../../utils/permissions'
import { useDB, tables, eq, and } from '../../../../../utils/database'

export default defineEventHandler(async (event) => {
  const domainId = getRouterParam(event, 'domainId')
  if (!domainId) {
    throw createError({
      status: 400,
      statusText: 'Domain ID is required'
    })
  }

  const { team } = await requireCan(event, 'team:domains')

  const db = useDB()

  // Get the domain to verify it belongs to the team and is verified
  const domain = await db
    .select()
    .from(tables.domain)
    .where(and(eq(tables.domain.id, domainId), eq(tables.domain.organizationId, team.id)))
    .get()

  if (!domain) {
    throw createError({
      status: 404,
      statusText: 'Domain not found'
    })
  }

  if (domain.status !== 'verified') {
    throw createError({
      status: 400,
      statusText: 'Only verified domains can be set as primary'
    })
  }

  // Remove primary from all other domains for this team
  await db
    .update(tables.domain)
    .set({ isPrimary: false })
    .where(eq(tables.domain.organizationId, team.id))

  // Set this domain as primary
  const [updatedDomain] = await db
    .update(tables.domain)
    .set({ isPrimary: true })
    .where(eq(tables.domain.id, domainId))
    .returning()

  return updatedDomain
})
