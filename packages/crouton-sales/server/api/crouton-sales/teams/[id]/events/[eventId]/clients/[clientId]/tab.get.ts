/**
 * Read-only preview of a client's open tab: the aggregated receipt lines the
 * end-receipt would print (identical product+price+options lines merged).
 * Backs the expandable rows in the workspace clients panel.
 */
import { aggregateClientTab } from '../../../../../../../../utils/client-tab'
import { requireTeamEvent } from '../../../../../../../../utils/team-event'

export default defineEventHandler(async (event) => {
  // Team scoping: the event must belong to the caller's team — the tab
  // aggregation itself only filters orders on eventId + clientId.
  const { db, eventId } = await requireTeamEvent(event)

  const clientId = getRouterParam(event, 'clientId')
  if (!clientId) {
    throw createError({ status: 400, statusText: 'Client ID is required' })
  }

  const { orderIds, lines, total } = await aggregateClientTab(db, eventId, clientId)
  return { lines, orderCount: orderIds.length, total }
})
