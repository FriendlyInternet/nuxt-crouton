/**
 * Revoke a claimed print device (#1366): deactivates the device's grant so
 * its polls answer `unclaimed` again (it re-prints its pairing ticket).
 * Scoped to the team's own claim — a device claimed elsewhere is a 404.
 */
import { eq, and } from 'drizzle-orm'
import { resolveTeamAndCheckMembership } from '@fyit/crouton-auth/server/utils/team'
import { revokeScopedGrantsForResource } from '@fyit/crouton-auth/server/utils/scoped-access'
import { scopedAccessGrant } from '@fyit/crouton-auth/server/database/schema/auth'

export default defineEventHandler(async (event) => {
  const { team } = await resolveTeamAndCheckMembership(event)
  const deviceId = getRouterParam(event, 'deviceId')?.trim().toLowerCase()
  if (!deviceId) {
    throw createError({ status: 400, statusText: 'Device id is required' })
  }

  const db = useDB()
  const [own] = await db
    .select({ id: scopedAccessGrant.id })
    .from(scopedAccessGrant)
    .where(
      and(
        eq(scopedAccessGrant.organizationId, team.id),
        eq(scopedAccessGrant.resourceType, 'print-device'),
        eq(scopedAccessGrant.resourceId, deviceId),
        eq(scopedAccessGrant.isActive, true)
      )
    )
    .limit(1)

  if (!own) {
    throw createError({ status: 404, statusText: 'Device not found' })
  }

  // Single-owner invariant (claim rejects cross-team) ⇒ revoking "all grants
  // for the resource" only ever touches this team's own claim.
  await revokeScopedGrantsForResource('print-device', deviceId)

  return { revoked: true, deviceId }
})
