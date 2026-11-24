import { requireScopedEvent } from '../../../../utils/require-scoped-event'
import { salesClients } from '../../../../../collections/clients/server/database/schema'
import { nanoid } from 'nanoid'

// Helper-authenticated endpoint: create a new client for the event's team
export default defineEventHandler(async (event) => {
  // The helper loads the event scoped to the token's team (404 otherwise).
  const { db, salesEvent } = await requireScopedEvent(event)

  const body = await readBody(event)
  const title = body?.title?.trim()

  if (!title) {
    throw createError({ status: 400, statusText: 'Client title is required' })
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
