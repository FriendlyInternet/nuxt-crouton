/**
 * DELETE /api/teams/[id]/domains/[domainId]
 *
 * Delete a custom domain from a team/organization.
 * If the deleted domain was primary, promotes another domain.
 * Requires the `team:domains` action (owner/admin by default).
 */
import { requireCan } from '../../../../utils/permissions'
import { useDB, tables, eq, and } from '../../../../utils/database'

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

  // Get the domain to verify it belongs to the team
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

  // Delete the domain
  await db.delete(tables.domain).where(eq(tables.domain.id, domainId))

  // If this was the primary domain, promote another domain if available
  if (domain.isPrimary) {
    const nextDomain = await db
      .select()
      .from(tables.domain)
      .where(eq(tables.domain.organizationId, team.id))
      .limit(1)
      .get()

    if (nextDomain) {
      await db
        .update(tables.domain)
        .set({ isPrimary: true })
        .where(eq(tables.domain.id, nextDomain.id))
    }
  }

  return { message: 'Domain deleted successfully' }
})
