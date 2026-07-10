/**
 * Polling endpoint for the RUT956 print spooler.
 *
 * Returns pending print jobs (status=0) for an event, with the denormalized
 * printer transport details. Pass `?mark_as_printing=true` to atomically flip
 * status→1 in the same call so concurrent pollers don't duplicate work.
 *
 * Per-event transport gate (#1324): events routed elsewhere ('local-drainer',
 * incl. jobs parked by 'none') get a soft-empty [] — router scripts loop
 * happily on empty, a 4xx would spam their logs. No row = the default
 * (router-spooler → allowed). While allowed, the liveness heartbeat is
 * stamped for the settings UI (see spoolerMayServe).
 */
import { requirePrintServerKey } from '../../../../utils/print-server-auth'
import { spoolerMayServe } from '../../../../utils/print-transport'
import { listSpoolerJobs } from '../../../../utils/print-job-queue'

export default defineEventHandler(async (event) => {
  requirePrintServerKey(event)

  const eventId = getRouterParam(event, 'eventId')
  if (!eventId) {
    throw createError({ status: 400, statusText: 'Event ID is required' })
  }

  const markAsPrinting = String(getQuery(event).mark_as_printing) === 'true'
  const db = useDB()

  if (!(await spoolerMayServe(db, eventId))) {
    return []
  }
  return await listSpoolerJobs(db, eventId, markAsPrinting)
})
