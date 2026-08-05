/**
 * @crouton-package crouton-sales
 * @description Ticket builder for the printer form's Testprint button (#1391).
 *
 * A test print is a tiny receipt pushed through the REAL print flow (generic
 * `print_jobs` queue → whatever transport the event's Print flow selects), so
 * one tap proves routing + transport + paper — not just the printer socket.
 * Pure function: the endpoint feeds the result to `encodeTicket(data, driver)`
 * and `enqueuePrintJob` (crouton-printing globals).
 */
import type { ReceiptData } from '@fyit/crouton-printing/server/utils/receipt-formatter'

export interface TestReceiptInput {
  /** Title of the printer under test — printed on the ticket so multi-printer tests are tellable-apart. */
  printerTitle: string
  eventName: string
  teamName: string
  /** Who pressed the button (their name prints as the helper line). */
  requestedBy?: string
  /** Event currency symbol passthrough — unused visually (no prices) but kept for encoder parity. */
  currencySymbol?: string
  now?: Date
}

export function buildTestReceipt(input: TestReceiptInput): ReceiptData {
  return {
    orderNumber: 'TEST',
    orderId: 'test-print',
    teamName: input.teamName,
    eventName: input.eventName,
    // Kitchen tickets print clientName as the big centered header — the
    // loudest possible "this is a test, not an order" marker.
    clientName: '*** TESTPRINT ***',
    helperName: input.requestedBy,
    // Language-neutral line (tickets carry no i18n runtime; CP858-safe chars).
    items: [{
      name: `Printer "${input.printerTitle}" OK`,
      quantity: 1,
      price: 0
    }],
    printMode: 'kitchen',
    showPrices: false,
    createdAt: input.now ?? new Date(),
    currencySymbol: input.currencySymbol
  }
}

/** Everything enqueuePrintJob needs for a test job, except the encoded payload. */
export interface TestPrintJobInput {
  source: 'sales'
  printerId: string
  printerIp: string | null
  printerPort: number | null
  printerTitle: string | null
  driver: string
  printMode: 'normal'
  locationId: null
  refType: 'test'
  refId: string
  eventId: string
  teamId: string
}

export interface TestPrintContext {
  eventId: string
  teamId: string
  teamName?: string | null
  eventName?: string | null
  /** Whoever pressed the button (prints as the helper line). */
  user?: { name?: string | null, email?: string | null }
}

/**
 * The whole test-print job, computed purely: the ticket content plus the
 * enqueue input (minus the payload — the endpoint encodes via the driver's
 * registered encoder). Holds all the nullable-column fallbacks so the H3
 * endpoint stays a thin shell.
 */
export function buildTestPrintJob(
  printer: { id: string, title?: string | null, ipAddress?: string | null, port?: number | string | null, driver?: string | null },
  ctx: TestPrintContext
): { receipt: ReceiptData, job: TestPrintJobInput } {
  const driver = printer.driver ?? 'network-escpos'
  const receipt = buildTestReceipt({
    printerTitle: printer.title ?? 'Printer',
    eventName: ctx.eventName ?? '',
    teamName: ctx.teamName ?? 'POS',
    requestedBy: ctx.user?.name || ctx.user?.email || undefined
  })
  return {
    receipt,
    job: {
      source: 'sales',
      printerId: printer.id,
      printerIp: printer.ipAddress ?? null,
      printerPort: printer.port != null ? Number(printer.port) : null,
      printerTitle: printer.title ?? null,
      driver,
      printMode: 'normal',
      locationId: null,
      refType: 'test',
      refId: printer.id,
      eventId: ctx.eventId,
      teamId: ctx.teamId
    }
  }
}
