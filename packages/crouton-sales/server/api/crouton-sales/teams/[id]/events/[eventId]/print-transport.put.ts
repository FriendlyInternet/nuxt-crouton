/**
 * Set the event's print-transport choice (#1324): 'local-drainer' (a venue
 * device prints straight to the printers over TCP), 'router-spooler' (the
 * on-site router polls the cloud), or 'none' (no physical printing — orders
 * enqueue no print jobs at all). Both drain points in crouton-printing
 * enforce the choice, so flipping it moves already-pending jobs to the other
 * flow.
 *
 * See the GET sibling for why this route lives in sales rather than printing.
 */
import { isPrintTransport, upsertPrintTransport, PRINT_TRANSPORT } from '@fyit/crouton-printing/server/utils/print-transport'
import { requireTeamEvent } from '../../../../../../utils/team-event'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ transport?: string }>(event).catch(() => null)
  const transport = body?.transport
  if (!isPrintTransport(transport)) {
    throw createError({
      status: 400,
      statusText: `transport must be one of ${Object.values(PRINT_TRANSPORT).join(' | ')}`
    })
  }

  const { db, eventId, team } = await requireTeamEvent(event)
  await upsertPrintTransport(db, { eventId, transport, teamId: team.id })
  return { transport }
})
