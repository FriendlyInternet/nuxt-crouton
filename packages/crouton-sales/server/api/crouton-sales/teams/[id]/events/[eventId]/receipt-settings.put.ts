import { eq, and } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { requireTeamEvent } from '../../../../../../utils/team-event'
import { salesEventsettings } from '~~/layers/sales/collections/eventsettings/server/database/schema'

export interface ReceiptSettings {
  special_instructions_title: string
  staff_order_header: string
  footer_text: string
}

export default defineEventHandler(async (event) => {
  const { team, user, db, eventId } = await requireTeamEvent(event)

  const body = await readBody<ReceiptSettings>(event)

  if (!body) {
    throw createError({ status: 400, statusText: 'Request body is required' })
  }

  const settingValue = JSON.stringify(body)

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

  if (existing) {
    await db
      .update(salesEventsettings)
      .set({ settingValue, updatedBy: user.id })
      .where(eq(salesEventsettings.id, existing.id))
  }
  else {
    await db.insert(salesEventsettings).values({
      id: nanoid(),
      teamId: team.id,
      owner: user.id,
      eventId,
      settingKey: 'receipt_settings',
      settingValue,
      description: 'Receipt text customization settings',
      createdAt: new Date(),
      updatedAt: new Date(),
      createdBy: user.id,
      updatedBy: user.id
    })
  }

  return { success: true }
})
