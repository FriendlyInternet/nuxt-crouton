/**
 * List the team's claimed print devices (#1366) — the routers coupled via the
 * printed pairing ticket. A device IS its scoped-access grant
 * (`resourceType 'print-device'`, resourceId = the device's persistent id);
 * secrets never leave the server. Liveness is already on the Print flow
 * picker (the router heartbeat dot) — this list carries identity only.
 */
import { eq, and } from 'drizzle-orm'
import { resolveTeamAndCheckMembership } from '@fyit/crouton-auth/server/utils/team'
import { scopedAccessGrant } from '@fyit/crouton-auth/server/database/schema/auth'

export default defineEventHandler(async (event) => {
  const { team } = await resolveTeamAndCheckMembership(event)
  const db = useDB()

  const grants = await db
    .select({
      deviceId: scopedAccessGrant.resourceId,
      claimedAt: scopedAccessGrant.createdAt
    })
    .from(scopedAccessGrant)
    .where(
      and(
        eq(scopedAccessGrant.organizationId, team.id),
        eq(scopedAccessGrant.resourceType, 'print-device'),
        eq(scopedAccessGrant.isActive, true)
      )
    )

  return grants
})
