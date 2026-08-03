/**
 * Read the event's print-transport choice (#1324) — which flow delivers this
 * event's thermal (`network-escpos`) print jobs: the in-process drainer on a
 * venue device, the on-site router spooler, or nobody. An event with no
 * recorded row resolves to the default (`router-spooler`) — the choice is
 * always exclusive.
 *
 * The setting itself lives in crouton-printing (`print_transports`); this
 * endpoint is the team-authed HTTP surface for it — crouton-printing depends
 * only on crouton-core and has no auth, so the domain package that already
 * has team membership checks owns the route (same seam as enqueuePrintJob).
 */
import { DEFAULT_PRINT_TRANSPORT, getPrintTransport } from '@fyit/crouton-printing/server/utils/print-transport'
import { requireTeamEvent } from '../../../../../../utils/team-event'

export default defineEventHandler(async (event) => {
  const { db, eventId } = await requireTeamEvent(event)

  const row = await getPrintTransport(db, eventId)
  if (!row) {
    return { transport: DEFAULT_PRINT_TRANSPORT, lastSpoolerPollAt: null, lastDrainerTickAt: null }
  }
  return {
    transport: row.transport,
    lastSpoolerPollAt: row.lastSpoolerPollAt,
    lastDrainerTickAt: row.lastDrainerTickAt
  }
})
