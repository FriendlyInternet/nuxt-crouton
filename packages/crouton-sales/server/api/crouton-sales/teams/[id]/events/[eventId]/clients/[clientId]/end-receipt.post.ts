/**
 * Settle a client's tab: print one end-of-tab receipt aggregating every
 * non-cancelled order the client placed at this event, then deactivate the
 * client (they disappear from the POS picker and the clients panel).
 *
 * The print job is enqueued to the event's receipt printer (fallback: the
 * first printer) through the generic crouton-printing queue (epic #325) with
 * refType='tab'/refId=clientId — it belongs to the whole tab, not one order, so
 * the order auto-complete reactions (which only act on refType='order') skip it.
 *
 * The ESC/POS engine (`encodeTicket`, `receiptCurrencySymbol`,
 * `DEFAULT_RECEIPT_SETTINGS`, the Receipt* types, `enqueuePrintJob`) is provided
 * as auto-imported globals by the crouton-printing layer.
 */
import { eq, and } from 'drizzle-orm'
import { resolveTeamAndCheckMembership } from '@fyit/crouton-auth/server/utils/team'
import type { ReceiptData, ReceiptItem, ReceiptSettings } from '@fyit/crouton-printing/server/utils/receipt-formatter'
import { aggregateClientTab } from '../../../../../../../../utils/client-tab'
import { salesEvents } from '~~/layers/sales/collections/events/server/database/schema'
import { salesClients } from '~~/layers/sales/collections/clients/server/database/schema'
import { salesPrinters } from '~~/layers/sales/collections/printers/server/database/schema'
import { salesEventsettings } from '~~/layers/sales/collections/eventsettings/server/database/schema'

export default defineEventHandler(async (event) => {
  const { team, user } = await resolveTeamAndCheckMembership(event)
  const eventId = getRouterParam(event, 'eventId')
  const clientId = getRouterParam(event, 'clientId')

  if (!eventId || !clientId) {
    throw createError({ status: 400, statusText: 'Event ID and Client ID are required' })
  }

  const db = useDB()

  const [salesEvent] = await db
    .select()
    .from(salesEvents)
    .where(and(eq(salesEvents.id, eventId), eq(salesEvents.teamId, team.id)))
    .limit(1)

  if (!salesEvent) {
    throw createError({ status: 404, statusText: 'Event not found' })
  }

  const [client] = await db
    .select()
    .from(salesClients)
    .where(and(eq(salesClients.id, clientId), eq(salesClients.teamId, team.id)))
    .limit(1)

  if (!client) {
    throw createError({ status: 404, statusText: 'Client not found' })
  }
  if (client.isActive === false) {
    throw createError({ status: 400, statusText: 'Client is already settled' })
  }

  // Aggregate identical lines across orders (shared with the tab preview
  // GET, so the panel shows exactly what this receipt prints).
  const tab = await aggregateClientTab(db, eventId, clientId)

  if (tab.orderIds.length === 0) {
    throw createError({ status: 400, statusText: 'Client has no orders at this event' })
  }

  const receiptItems: ReceiptItem[] = tab.lines.map(line => ({
    name: line.name,
    quantity: line.quantity,
    price: line.price,
    options: line.optionLabels.length > 0
      ? Object.fromEntries(line.optionLabels.map(label => [label, label]))
      : undefined
  }))
  const total = tab.total

  // The tab settles on the receipt printer; events with only kitchen
  // printers fall back to the first one so the flow still works.
  const printers = await db.select().from(salesPrinters).where(eq(salesPrinters.eventId, eventId))
  const printer = printers.find((p: any) => p.type === 'receipt') || printers[0]
  if (!printer) {
    throw createError({ status: 400, statusText: 'No printers configured for this event' })
  }

  // Per-event receipt text customization, same fallback as order printing
  let receiptSettings: ReceiptSettings = DEFAULT_RECEIPT_SETTINGS
  const [settingsRow] = await db
    .select()
    .from(salesEventsettings)
    .where(and(
      eq(salesEventsettings.eventId, eventId),
      eq(salesEventsettings.settingKey, 'receipt_settings')
    ))
  if (settingsRow?.settingValue) {
    try {
      receiptSettings = { ...DEFAULT_RECEIPT_SETTINGS, ...JSON.parse(settingsRow.settingValue) }
    } catch {
      receiptSettings = DEFAULT_RECEIPT_SETTINGS
    }
  }

  const receiptData: ReceiptData = {
    orderNumber: '',
    orderId: '',
    teamName: team.name || 'POS',
    eventName: salesEvent.title,
    clientName: client.title,
    helperName: user.name || undefined,
    items: receiptItems,
    total,
    printMode: 'receipt',
    showPrices: true,
    createdAt: new Date(),
    receiptSettings,
    currencySymbol: receiptCurrencySymbol(salesEvent.currency || undefined),
    clientTab: { orderCount: tab.orderIds.length }
  }

  // Encode for the receipt printer's output driver (network-escpos = base64
  // ESC/POS, browser-print = JSON) and enqueue onto the generic print_jobs
  // queue. refType='tab' so the order auto-complete reactions skip it.
  // Print flow 'none' (#1324): settle the tab but skip the paper — an
  // enqueued job would sit pending forever (nothing delivers this event).
  const transportRow = await getPrintTransport(db, eventId)
  let queueId: string | null = null
  if (transportRow?.transport !== PRINT_TRANSPORT.NONE) {
    const driver = printer.driver ?? 'network-escpos'
    queueId = await enqueuePrintJob(db, {
      source: 'sales',
      printerId: printer.id,
      printerIp: printer.ipAddress ?? null,
      printerPort: printer.port != null ? Number(printer.port) : null,
      printerTitle: printer.title ?? null,
      driver,
      payload: encodeTicket(receiptData, driver),
      printMode: 'receipt',
      locationId: null,
      refType: 'tab',
      refId: clientId,
      eventId,
      teamId: team.id
    })
  }

  // Settled: hide the client from the POS picker and the clients panel.
  await db
    .update(salesClients)
    .set({ isActive: false, updatedBy: user.id })
    .where(eq(salesClients.id, clientId))

  return {
    success: true,
    queueId,
    orderCount: tab.orderIds.length,
    total
  }
})
