import { eq, and } from 'drizzle-orm'
import { requireTeamEvent } from '../../../../../../utils/team-event'
// Single source of truth (#1514): the default an unsaved event shows in the
// form MUST equal what the formatter prints when no settings row exists —
// crouton-printing owns that canonical default. A local copy here diverged
// (English) from the formatter (Dutch), so the form lied about what prints.
import { DEFAULT_RECEIPT_SETTINGS, type ReceiptSettings } from '@fyit/crouton-printing/server/utils/receipt-formatter'
import { salesEventsettings } from '~~/layers/sales/collections/eventsettings/server/database/schema'

export type { ReceiptSettings }

export default defineEventHandler(async (event) => {
  const { team, db, eventId } = await requireTeamEvent(event)

  const [existing] = await db
    .select()
    .from(salesEventsettings)
    .where(
      and(
        eq(salesEventsettings.teamId, team.id),
        eq(salesEventsettings.eventId, eventId),
        eq(salesEventsettings.settingKey, 'receipt_settings')
      )
    )

  if (existing?.settingValue) {
    try {
      return JSON.parse(existing.settingValue) as ReceiptSettings
    }
    catch {
      return DEFAULT_RECEIPT_SETTINGS
    }
  }

  return DEFAULT_RECEIPT_SETTINGS
})
