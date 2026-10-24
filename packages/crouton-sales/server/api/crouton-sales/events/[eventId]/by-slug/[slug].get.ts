import { eq, and } from 'drizzle-orm'
import { resolveTeamBySlugOrId } from '@fyit/crouton-auth/server/utils/team'
import { salesEvents } from '../../../../../../collections/events/server/database/schema'

// Public endpoint: resolve event by slug for helper login flow.
// The first segment carries the team's UUID or slug. The folder/param is named
// `eventId` (not `teamId`) ONLY so it matches its `events/[eventId]/…` siblings:
// h3 v1's radix3 router keeps a single param node per position, so mixing
// `[eventId]` and `[teamId]` here silently dropped the deeper two-param routes
// (`orders/[orderId]/…`) — see issue #116. Revert to `[teamId]` once the server
// runs on h3 v2 / rou3 (Nitro 3), which handles mixed param names per position.
export default defineEventHandler(async (event) => {
  const { team } = await resolveTeamBySlugOrId(event, 'eventId')
  const slug = getRouterParam(event, 'slug')

  if (!slug) {
    throw createError({ status: 400, statusText: 'Slug is required' })
  }

  const db = useDB()

  const [salesEvent] = await db
    .select({
      id: salesEvents.id,
      teamId: salesEvents.teamId,
      title: salesEvents.title,
      slug: salesEvents.slug,
      status: salesEvents.status,
      currency: salesEvents.currency
    })
    .from(salesEvents)
    .where(and(eq(salesEvents.teamId, team.id), eq(salesEvents.slug, slug)))
    .limit(1)

  if (!salesEvent) {
    throw createError({ status: 404, statusText: 'Event not found' })
  }

  return salesEvent
})
