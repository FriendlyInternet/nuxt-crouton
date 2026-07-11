/**
 * @crouton-package crouton-sales
 * @description Sample-ticket builder for the printer form's Voorbeeld (preview)
 * button (#1504).
 *
 * Unlike the Testprint (which pushes a real job through the queue), the preview
 * only RENDERS what a ticket looks like — the endpoint feeds this `ReceiptData`
 * to `renderTicketHtml` and returns the HTML for an in-modal iframe. The sample
 * is deliberately representative so the reviewer sees the real layout AND their
 * own receipt-text settings on paper:
 *  - a personnel order → the `staff_order_header` banner prints,
 *  - a per-order note → the `special_instructions_title` (kitchen) / NOTES
 *    (receipt) block prints,
 *  - a receipt-type printer → the `footer_text` prints,
 *  - one detailed item (options + note) → shows the #1503 tight-vs-spaced items.
 *
 * Pure function (mirrors `buildTestReceipt`): all IO — printer lookup, settings
 * load, currency, rendering — stays in the endpoint.
 */
import type { ReceiptData, ReceiptItem, ReceiptSettings } from '@fyit/crouton-printing/server/utils/receipt-formatter'

/** The saved printer fields the preview reads (a subset of the salesPrinters row). */
export interface PreviewPrinter {
  title?: string | null
  showPrices?: boolean | null
  /** 'kitchen' | 'receipt' | null (null ⇒ kitchen). */
  type?: string | null
}

export interface PreviewContext {
  teamName?: string | null
  eventName?: string | null
  /** Currency symbol for prices (from the event currency). */
  currencySymbol?: string
  /** Prints as the helper line (usually the signed-in admin's name). */
  requestedBy?: string
  now?: Date
}

/** A fixed, representative basket — one plain drink, one detailed item (option +
 * note), then two plain items, so both the tight and the spaced item layouts show. */
const SAMPLE_ITEMS: ReceiptItem[] = [
  { name: 'Frisdrank', quantity: 1, price: 2.0 },
  { name: 'Frietjes', quantity: 2, price: 3.5, notes: 'zonder ui', options: { Saus: { label: 'Mayonaise', price: 0.5 } } },
  { name: 'Koffie', quantity: 2, price: 1.8 },
  { name: 'Pils', quantity: 1, price: 2.5 }
]

/** Sample per-order note, so the special-instructions / NOTES block appears. */
const SAMPLE_NOTE = 'Allergie: noten'

export function buildPreviewReceipt(
  printer: PreviewPrinter,
  ctx: PreviewContext,
  receiptSettings: ReceiptSettings
): ReceiptData {
  const showPrices = printer.showPrices ?? true
  const isReceipt = printer.type === 'receipt'

  // Match the real print total: sum of line prices (options are shown but not
  // summed into the total — same as generateKitchenTicketData/generateReceiptData).
  const total = SAMPLE_ITEMS.reduce((sum, item) => sum + (item.price ?? 0) * item.quantity, 0)

  return {
    orderNumber: '0007',
    orderId: 'preview',
    teamName: ctx.teamName || 'Team',
    eventName: ctx.eventName || 'Event',
    clientName: 'Tafel 7',
    helperName: ctx.requestedBy,
    orderNotes: SAMPLE_NOTE,
    items: SAMPLE_ITEMS,
    total: showPrices ? total : undefined,
    printMode: isReceipt ? 'receipt' : 'kitchen',
    showPrices,
    isPersonnel: true,
    createdAt: ctx.now ?? new Date(),
    currencySymbol: ctx.currencySymbol,
    receiptSettings
  }
}
