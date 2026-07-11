/**
 * Slim per-event print job status for the register overview's printer LEDs.
 *
 * Reads the generic crouton-printing `print_jobs` queue (epic #325) filtered to
 * this team's sales jobs. The orderId the UI expects is the job's opaque
 * `refId` (refType='order'). Returns only the fields the LEDs/popovers render —
 * never the bulky base64 payload — so it stays cheap to poll every couple of
 * seconds.
 */
import { eq, and } from 'drizzle-orm'
import { resolveTeamAndCheckMembership } from '@fyit/crouton-auth/server/utils/team'
import { printJobs } from '@fyit/crouton-printing/server/database/schema'

export default defineEventHandler(async (event) => {
  const { team } = await resolveTeamAndCheckMembership(event)
  const eventId = getRouterParam(event, 'eventId')

  if (!eventId) {
    throw createError({ status: 400, statusText: 'Event ID is required' })
  }

  const db = useDB()

  return db
    .select({
      id: printJobs.id,
      // The job's domain back-reference IS the orderId (refType='order').
      orderId: printJobs.refId,
      printerId: printJobs.printerId,
      // Denormalized printer label — the drift-proof fallback key the LED uses
      // when a job's printerId no longer matches a current salesPrinters row
      // (deleted+recreated / regenerated collection). See app/utils/printer-led.ts (#1507).
      printerTitle: printJobs.printerTitle,
      status: printJobs.status,
      // locationId + printMode let OrderItems list what each ticket printed
      // (kitchen jobs = that location's items, receipt jobs = whole order).
      locationId: printJobs.locationId,
      printMode: printJobs.printMode,
      errorMessage: printJobs.errorMessage,
      retryCount: printJobs.retryCount,
      createdAt: printJobs.createdAt,
      completedAt: printJobs.completedAt
    })
    .from(printJobs)
    .where(and(
      eq(printJobs.teamId, team.id),
      eq(printJobs.eventId, eventId),
      eq(printJobs.source, 'sales')
    ))
})
