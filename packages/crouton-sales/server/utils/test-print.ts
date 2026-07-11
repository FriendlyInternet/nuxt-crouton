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
