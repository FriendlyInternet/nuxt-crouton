/**
 * Receipt preview (#1504): render — but never queue — a representative ticket
 * for ONE printer, so the printer form can show what this station actually
 * prints. Returns `{ html, printer }` where `html` is `renderTicketHtml` output
 * (the SAME encoder the browser-print driver uses) dropped into a sandboxed
 * iframe by the modal, so the preview can't drift from reality.
 *
 * Crucially it resolves the event's receipt-text settings the SAME way real
 * printing does — the formatter's defaults overlaid with the saved
 * `receipt_settings` row (generate-print-queues.ts) — NOT the settings-form GET
 * default. So the preview answers "what will actually print", including whether
 * a setting has been saved yet.
 *
 * Thin shell: lookups live in requireTeamEvent / requireEventPrinter, the ticket
 * content in buildPreviewReceipt (pure, tested). renderTicketHtml /
 * DEFAULT_RECEIPT_SETTINGS / receiptCurrencySymbol come from crouton-printing.
 */
import { and, eq } from 'drizzle-orm'
import { DEFAULT_RECEIPT_SETTINGS, renderTicketHtml, type ReceiptSettings } from '@fyit/crouton-printing/server/utils/receipt-formatter'
import { receiptCurrencySymbol } from '@fyit/crouton-printing/server/utils/print-queue-service'
import { requireTeamEvent } from '../../../../../../../../utils/team-event'
import { requireEventPrinter } from '../../../../../../../../utils/event-printer'
import { buildPreviewReceipt } from '../../../../../../../../utils/preview-receipt'

export default defineEventHandler(async (event) => {
  const { team, user, db, eventId, salesEvent } = await requireTeamEvent(event)
  const printer = await requireEventPrinter(db, event, eventId)

  // Same resolution as generate-print-queues: formatter defaults overlaid with
  // the saved receipt_settings row (if any), so the preview mirrors printing.
  let receiptSettings: ReceiptSettings = DEFAULT_RECEIPT_SETTINGS
  const { salesEventsettings } = await import('~~/layers/sales/collections/eventsettings/server/database/schema')
  const [settingsRow] = await db
    .select()
    .from(salesEventsettings)
    .where(and(
      eq(salesEventsettings.teamId, team.id),
      eq(salesEventsettings.eventId, eventId),
      eq(salesEventsettings.settingKey, 'receipt_settings')
    ))
  if (settingsRow?.settingValue) {
    try {
      receiptSettings = { ...DEFAULT_RECEIPT_SETTINGS, ...JSON.parse(settingsRow.settingValue) }
    }
    catch {
      receiptSettings = DEFAULT_RECEIPT_SETTINGS
    }
  }

  const receipt = buildPreviewReceipt(
    { title: printer.title, showPrices: printer.showPrices, type: printer.type },
    {
      teamName: team.name,
      eventName: salesEvent.title,
      currencySymbol: receiptCurrencySymbol(salesEvent.currency),
      requestedBy: user.name || user.email || undefined
    },
    receiptSettings
  )

  return {
    html: renderTicketHtml(receipt),
    printer: {
      title: printer.title,
      ipAddress: printer.ipAddress,
      port: printer.port ?? null,
      type: printer.type ?? 'kitchen',
      showPrices: printer.showPrices ?? true,
      isActive: printer.isActive ?? true
    }
  }
})
