/**
 * Testprint (#1391): enqueue a tiny test ticket for ONE printer through the
 * REAL print flow — generic `print_jobs` queue, delivered by whatever
 * transport the event's Print flow selects (router spooler / local drainer).
 * One tap proves routing + transport + paper, without placing a fake order.
 *
 * Refuses (409) when the event's flow is 'none' (no physical printing) — an
 * enqueued job would sit pending forever, which reads as a broken printer.
 * `refType: 'test'` keeps it out of the order auto-complete reactions (they
 * act on refType 'order' only).
 *
 * The engine pieces (`encodeTicket`, `enqueuePrintJob`) are crouton-printing
 * nitro globals, same as the order path.
 */
import { eq, and } from 'drizzle-orm'
import { PRINT_TRANSPORT, getPrintTransport } from '@fyit/crouton-printing/server/utils/print-transport'
import { requireTeamEvent } from '../../../../../../../../utils/team-event'
import { buildTestReceipt } from '../../../../../../../../utils/test-print'
import { salesPrinters } from '~~/layers/sales/collections/printers/server/database/schema'

export default defineEventHandler(async (event) => {
  const { team, user, db, eventId, salesEvent } = await requireTeamEvent(event)

  const printerId = getRouterParam(event, 'printerId')
  if (!printerId) {
    throw createError({ status: 400, statusText: 'Printer ID is required' })
  }

  const [printer] = await db
    .select()
    .from(salesPrinters)
    .where(and(eq(salesPrinters.id, printerId), eq(salesPrinters.eventId, eventId)))
    .limit(1)
  if (!printer) {
    throw createError({ status: 404, statusText: 'Printer not found for this event' })
  }

  // 'none' = no physical printing: refuse loudly instead of queueing a job
  // nothing will ever deliver.
  const transportRow = await getPrintTransport(db, eventId)
  if (transportRow?.transport === PRINT_TRANSPORT.NONE) {
    throw createError({
      status: 409,
      statusText: 'Print flow is set to no physical printing — pick a flow first'
    })
  }

  const driver = printer.driver ?? 'network-escpos'
  const receipt = buildTestReceipt({
    printerTitle: printer.title ?? 'Printer',
    eventName: salesEvent.title ?? '',
    teamName: team.name ?? 'POS',
    requestedBy: user.name || user.email || undefined
  })

  const queueId = await enqueuePrintJob(db, {
    source: 'sales',
    printerId: printer.id,
    printerIp: printer.ipAddress ?? null,
    printerPort: printer.port != null ? Number(printer.port) : null,
    printerTitle: printer.title ?? null,
    driver,
    payload: encodeTicket(receipt, driver),
    printMode: 'normal',
    locationId: null,
    refType: 'test',
    refId: printer.id,
    eventId,
    teamId: team.id
  })

  return { queueId }
})
