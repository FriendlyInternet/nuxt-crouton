/**
 * @crouton-package crouton-sales
 * @description Guard for `.../events/[eventId]/printers/[printerId]/*`
 * endpoints: resolve the printer AND verify it belongs to the event.
 * Companion to `requireTeamEvent` (call that first for the team/event half).
 */
import type { H3Event } from 'h3'
import { and, eq } from 'drizzle-orm'

export async function requireEventPrinter(db: any, event: H3Event, eventId: string) {
  const printerId = getRouterParam(event, 'printerId')
  if (!printerId) {
    throw createError({ status: 400, statusText: 'Printer ID is required' })
  }

  const { salesPrinters } = await import('~~/layers/sales/collections/printers/server/database/schema')
  const [printer] = await db
    .select()
    .from(salesPrinters)
    .where(and(eq(salesPrinters.id, printerId), eq(salesPrinters.eventId, eventId)))
    .limit(1)
  if (!printer) {
    throw createError({ status: 404, statusText: 'Printer not found for this event' })
  }

  return printer
}
