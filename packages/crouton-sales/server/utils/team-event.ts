/**
 * @crouton-package crouton-sales
 * @description Shared guard for `teams/[id]/events/[eventId]/*` endpoints:
 * team membership + "the event belongs to this team" ownership in one call.
 *
 * Extracted from the per-endpoint copies (print-transport GET/PUT,
 * end-receipt, …) the #1324 fallow audit flagged as clone groups — new
 * event-scoped endpoints should start here instead of re-pasting the
 * boilerplate. Throws 400 on a missing param, 404 when the event isn't the
 * team's. Returns the full sales event row (title/currency/… are needed by
 * receipt flows) plus the db handle so callers query on the same connection.
 */
import type { H3Event } from 'h3'
import { and, eq } from 'drizzle-orm'
import { resolveTeamAndCheckMembership } from '@fyit/crouton-auth/server/utils/team'

export async function requireTeamEvent(event: H3Event) {
  const { team, user } = await resolveTeamAndCheckMembership(event)

  const eventId = getRouterParam(event, 'eventId')
  if (!eventId) {
    throw createError({ status: 400, statusText: 'Event ID is required' })
  }

  const db = useDB()
  const { salesEvents } = await import('~~/layers/sales/collections/events/server/database/schema')
  const [salesEvent] = await db
    .select()
    .from(salesEvents)
    .where(and(eq(salesEvents.id, eventId), eq(salesEvents.teamId, team.id)))
    .limit(1)
  if (!salesEvent) {
    throw createError({ status: 404, statusText: 'Event not found' })
  }

  return { team, user, db, eventId, salesEvent }
}
