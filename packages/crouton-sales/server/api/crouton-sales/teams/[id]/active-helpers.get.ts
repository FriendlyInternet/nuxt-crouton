import { eq, and, gt, inArray } from 'drizzle-orm'
import { resolveTeamAndCheckMembership } from '@fyit/crouton-auth/server/utils/team'
import { scopedAccessToken } from '@fyit/crouton-auth/server/database/schema/auth'
import { salesEvents } from '../../../../../collections/events/server/database/schema'

export default defineEventHandler(async (event) => {
  const { team } = await resolveTeamAndCheckMembership(event)
  const db = useDB()

  const teamEvents = await db
    .select({ id: salesEvents.id, title: salesEvents.title })
    .from(salesEvents)
    .where(eq(salesEvents.teamId, team.id))

  if (teamEvents.length === 0) {
    return []
  }

  const eventTitleById = new Map(teamEvents.map((e: { id: string, title: string }) => [e.id, e.title] as const))

  const tokens = await db
    .select({
      id: scopedAccessToken.id,
      displayName: scopedAccessToken.displayName,
      role: scopedAccessToken.role,
      resourceId: scopedAccessToken.resourceId,
      expiresAt: scopedAccessToken.expiresAt,
      lastActiveAt: scopedAccessToken.lastActiveAt
    })
    .from(scopedAccessToken)
    .where(
      and(
        eq(scopedAccessToken.organizationId, team.id),
        eq(scopedAccessToken.resourceType, 'event'),
        eq(scopedAccessToken.isActive, true),
        gt(scopedAccessToken.expiresAt, new Date()),
        inArray(scopedAccessToken.resourceId, teamEvents.map((e: { id: string }) => e.id))
      )
    )

  return tokens.map((t: { resourceId: string }) => ({
    ...t,
    eventTitle: eventTitleById.get(t.resourceId) ?? null
  }))
})
