/**
 * Slim per-order print job status for the POS checkout button's print watcher.
 *
 * Helper-token equivalent of the team-authed `printqueues/status` GET: any
 * token that could create the order can watch it print. Reads the generic
 * crouton-printing `print_jobs` queue (epic #325) for this order's jobs
 * (refType='order', refId=orderId, source='sales'). The printer name comes from
 * the job's denormalized `printerTitle` (no join — the job is self-contained).
 * An empty array is a real answer (the order generated no tickets), not an error.
 */
import { eq, and } from 'drizzle-orm'
import { requireScopedAccessToResource } from '@fyit/crouton-auth/server/utils/scoped-access'
import { salesOrders } from '../../../../../../../collections/orders/server/database/schema'
import { printJobs } from '@fyit/crouton-printing/server/database/schema'

export default defineEventHandler(async (event) => {
  const eventId = getRouterParam(event, 'eventId')
  const orderId = getRouterParam(event, 'orderId')

  if (!eventId || !orderId) {
    throw createError({ status: 400, statusText: 'Event ID and Order ID are required' })
  }

  await requireScopedAccessToResource(event, 'event', eventId)
  const db = useDB()

  const [order] = await db
    .select({ id: salesOrders.id, eventId: salesOrders.eventId })
    .from(salesOrders)
    .where(eq(salesOrders.id, orderId))
    .limit(1)

  if (!order || order.eventId !== eventId) {
    throw createError({ status: 404, statusText: 'Order not found' })
  }

  const jobs = await db
    .select({
      id: printJobs.id,
      status: printJobs.status,
      errorMessage: printJobs.errorMessage,
      retryCount: printJobs.retryCount,
      printMode: printJobs.printMode,
      // Denormalized on the job at enqueue time — no printers join needed.
      printerTitle: printJobs.printerTitle,
      completedAt: printJobs.completedAt
    })
    .from(printJobs)
    .where(and(
      eq(printJobs.source, 'sales'),
      eq(printJobs.refType, 'order'),
      eq(printJobs.refId, orderId)
    ))

  // Display (KDS) jobs are bumped on a screen, not printed — they stay "shown"
  // until the kitchen acts, which is not the ordering volunteer's concern. This
  // endpoint feeds only the checkout print-watcher, so drop them here. Kitchen/
  // receipt jobs never have a 'display' printMode, so this only removes display rows.
  return jobs.filter((j: any) => j.printMode !== 'display')
})
