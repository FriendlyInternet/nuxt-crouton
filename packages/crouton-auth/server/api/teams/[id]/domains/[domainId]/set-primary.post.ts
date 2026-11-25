/**
 * POST /api/teams/[id]/domains/[domainId]/set-primary
 *
 * Set a domain as the primary domain for a team/organization.
 * Only verified domains can be set as primary.
 * Requires the `team:domains` action (owner/admin by default).
 */
import { requireCan } from '../../../../../utils/permissions'
import { tables, eq } from '../../../../../utils/database'
import { requireTeamDomain } from '../../../../../utils/team-domain'

export default defineEventHandler(async (event) => {
  // The domain must belong to the team (404 otherwise)…
  const { db, team, domain, domainId } = await requireTeamDomain(event, () => requireCan(event, 'team:domains'))

  // …and be verified
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
