/**
 * Read the event's print-transport choice (#1324) — which flow delivers this
 * event's thermal (`network-escpos`) print jobs: the in-process drainer on a
 * venue device, the on-site router spooler, or nobody. `transport: null`
 * means no choice recorded yet (legacy: both transports allowed).
 *
 * The setting itself lives in crouton-printing (`print_transports`); this
 * endpoint is the team-authed HTTP surface for it — crouton-printing depends
 * only on crouton-core and has no auth, so the domain package that already
 * has team membership checks owns the route (same seam as enqueuePrintJob).
 */
import { eq, and } from 'drizzle-orm'
import { resolveTeamAndCheckMembership } from '@fyit/crouton-auth/server/utils/team'
import { getPrintTransport } from '@fyit/crouton-printing/server/utils/print-transport'
import { salesEvents } from '~~/layers/sales/collections/events/server/database/schema'

export default defineEventHandler(async (event) => {
  const { team } = await resolveTeamAndCheckMembership(event)
  const eventId = getRouterParam(event, 'eventId')
  if (!eventId) {
    throw createError({ status: 400, statusText: 'Event ID is required' })
  }

  const db = useDB()

  const [salesEvent] = await db
    .select({ id: salesEvents.id })
    .from(salesEvents)
    .where(and(eq(salesEvents.id, eventId), eq(salesEvents.teamId, team.id)))
  if (!salesEvent) {
    throw createError({ status: 404, statusText: 'Event not found' })
  }

  const row = await getPrintTransport(db, eventId)
  return {
    transport: row?.transport ?? null,
    lastSpoolerPollAt: row?.lastSpoolerPollAt ?? null,
    lastDrainerTickAt: row?.lastDrainerTickAt ?? null
  }
})
