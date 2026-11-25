import { and, eq } from 'drizzle-orm'
import { requireScopedEvent } from '../../../../utils/require-scoped-event'
import { salesProducts } from '../../../../../collections/products/server/database/schema'
import { salesCategories } from '../../../../../collections/categories/server/database/schema'
import { salesClients } from '../../../../../collections/clients/server/database/schema'
import { salesLocations } from '../../../../../collections/locations/server/database/schema'

// Helper-authenticated endpoint: all data needed for POS order interface
export default defineEventHandler(async (event) => {
  // The helper loads the event scoped to the token's team (404 otherwise).
  const { eventId, access, db, salesEvent } = await requireScopedEvent(event)

  const products = await db
    .select()
    .from(salesProducts)
    .where(eq(salesProducts.eventId, eventId))

  // Scope to the event, not the team — duplicated events clone their
  // categories, so team-wide fetching showed every clone as a duplicate tab.
  const categories = await db
    .select()
    .from(salesCategories)
    .where(eq(salesCategories.eventId, eventId))

  // Only active clients: a client is deactivated when their end-of-tab
  // receipt is printed, which removes them from the POS picker.
  const clients = await db
    .select({ id: salesClients.id, title: salesClients.title })
    .from(salesClients)
    .where(and(
      eq(salesClients.teamId, salesEvent.teamId),
      eq(salesClients.isActive, true)
    ))

  // Locations for this event — used to label per-location remark inputs in the POS.
  const locations = await db
    .select({ id: salesLocations.id, title: salesLocations.title })
    .from(salesLocations)
    .where(eq(salesLocations.eventId, eventId))

  return {
    event: {
      id: salesEvent.id,
      title: salesEvent.title,
      slug: salesEvent.slug,
      teamId: salesEvent.teamId,
      requiresClient: salesEvent.requiresClient,
      currency: salesEvent.currency || 'EUR'
    },
    products,
    categories,
    clients,
    locations,
    helper: {
      id: access.id,
      name: access.displayName
    }
  }
})
