/**
 * Set the event's print-transport choice (#1324): 'local-drainer' (a venue
 * device prints straight to the printers over TCP), 'router-spooler' (the
 * on-site router polls the cloud), or 'none' (paused — jobs queue, nobody
 * delivers). Both drain points in crouton-printing enforce the choice, so
 * flipping it moves already-pending jobs to the other flow.
 *
 * See the GET sibling for why this route lives in sales rather than printing.
 */
import { eq, and } from 'drizzle-orm'
import { resolveTeamAndCheckMembership } from '@fyit/crouton-auth/server/utils/team'
import { isPrintTransport, upsertPrintTransport, PRINT_TRANSPORT } from '@fyit/crouton-printing/server/utils/print-transport'
import { salesEvents } from '~~/layers/sales/collections/events/server/database/schema'

export default defineEventHandler(async (event) => {
  const { team } = await resolveTeamAndCheckMembership(event)
  const eventId = getRouterParam(event, 'eventId')
  if (!eventId) {
    throw createError({ status: 400, statusText: 'Event ID is required' })
  }

  const body = await readBody<{ transport?: string }>(event).catch(() => null)
  if (!isPrintTransport(body?.transport)) {
    throw createError({
      status: 400,
      statusText: `transport must be one of ${Object.values(PRINT_TRANSPORT).join(' | ')}`
    })
  }

  const db = useDB()

  const [salesEvent] = await db
    .select({ id: salesEvents.id })
    .from(salesEvents)
    .where(and(eq(salesEvents.id, eventId), eq(salesEvents.teamId, team.id)))
  if (!salesEvent) {
    throw createError({ status: 404, statusText: 'Event not found' })
  }

  await upsertPrintTransport(db, { eventId, transport: body.transport, teamId: team.id })
  return { transport: body.transport }
})
