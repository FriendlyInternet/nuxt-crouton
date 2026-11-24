/**
 * DELETE /api/teams/[id]/domains/[domainId]
 *
 * Delete a custom domain from a team/organization.
 * If the deleted domain was primary, promotes another domain.
 * Requires the `team:domains` action (owner/admin by default).
 */
import { requireCan } from '../../../../utils/permissions'
import { tables, eq } from '../../../../utils/database'
import { requireTeamDomain } from '../../../../utils/team-domain'

export default defineEventHandler(async (event) => {
  // Get the domain to verify it belongs to the team (404 otherwise)
  const { db, team, domain, domainId } = await requireTeamDomain(event, () => requireCan(event, 'team:domains'))

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
