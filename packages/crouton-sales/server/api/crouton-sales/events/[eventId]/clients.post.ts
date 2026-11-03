import { eq } from 'drizzle-orm'
import { requireScopedAccessToResource } from '@fyit/crouton-auth/server/utils/scoped-access'
import { salesClients } from '../../../../../collections/clients/server/database/schema'
import { salesEvents } from '../../../../../collections/events/server/database/schema'
import { nanoid } from 'nanoid'

// Helper-authenticated endpoint: create a new client for the event's team
export default defineEventHandler(async (event) => {
  const eventId = getRouterParam(event, 'eventId')

  if (!eventId) {
    throw createError({ status: 400, statusText: 'Event ID is required' })
  }

  await requireScopedAccessToResource(event, 'event', eventId)

  const body = await readBody(event)
  const title = body?.title?.trim()

  if (!title) {
    throw createError({ status: 400, statusText: 'Client title is required' })
  }

  const db = useDB()

  const [salesEvent] = await db
    .select()
    .from(salesEvents)
    .where(eq(salesEvents.id, eventId))
    .limit(1)

  if (!salesEvent) {
    throw createError({ status: 404, statusText: 'Event not found' })
  }

  const [newClient] = await (db as any)
    .insert(salesClients)
    .values({
      id: nanoid(),
      teamId: salesEvent.teamId,
      owner: 'helper',
      title,
      isReusable: true,
      createdBy: 'helper',
      updatedBy: 'helper'
    })
    .returning()

  return newClient
})
