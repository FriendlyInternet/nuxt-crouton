// Generated with JSON field post-processing support (v2025-01-11)
import { eq, and, desc, inArray, exists, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/sqlite-core'
import * as tables from './schema'
import type { SalesOrder, NewSalesOrder } from '../../types'
import * as eventsSchema from '../../../events/server/database/schema'
import * as clientsSchema from '../../../clients/server/database/schema'
import { user } from '~~/server/db/schema'
// Sales-specific order filters live here (not in the generic generator): the
// register's "Bestellingen" pane filters by helper, printer and print status.
// Printer/status match against the shared crouton-printing queue via EXISTS.
import { printJobs } from '@fyit/crouton-printing/server/database/schema'

// Print-status buckets (job status is TEXT '0'|'1'|'2'|'9'): busy = pending or
// printing, done = completed, failed = errored. Mirrors the LED bucketing.
const PRINT_STATUS_BUCKETS: Record<string, string[]> = {
  busy: ['0', '1'],
  done: ['2'],
  failed: ['9']
}

type SalesOrderFilters = { eventId?: string, clientId?: string, owner?: string, printerId?: string, printStatus?: string }

// Correlated EXISTS over this order's sales print jobs (refType='order',
// refId=order.id) — used for the printer and print-status filters.
function orderHasJob(extra: ReturnType<typeof and>) {
  return exists(
    (useDB() as any)
      .select({ one: sql`1` })
      .from(printJobs)
      .where(and(
        eq(printJobs.source, 'sales'),
        eq(printJobs.refType, 'order'),
        eq(printJobs.refId, tables.salesOrders.id),
        extra
      ))
  )
}

// Build the shared WHERE for both the list and the pagination count so a
// filtered page and its total stay in sync.
function salesOrderConditions(teamId: string, opts: SalesOrderFilters) {
  const conditions = [eq(tables.salesOrders.teamId, teamId)]
  if (opts.eventId) conditions.push(eq(tables.salesOrders.eventId, opts.eventId))
  if (opts.clientId) conditions.push(eq(tables.salesOrders.clientId, opts.clientId))
  // owner stores the helper displayName (stable across logins), which is what
  // the OrdersTab helper filter sends.
  if (opts.owner) conditions.push(eq(tables.salesOrders.owner, opts.owner))
  if (opts.printerId) conditions.push(orderHasJob(eq(printJobs.printerId, opts.printerId)))
  const bucket = opts.printStatus ? PRINT_STATUS_BUCKETS[opts.printStatus] : undefined
  if (bucket) conditions.push(orderHasJob(inArray(printJobs.status, bucket)))
  return and(...conditions)
}

// Overload order matters: the paginated signature (required `limit`) must come
// first so non-paginated calls fall through to the array overload.
export async function getAllSalesOrders(teamId: string, opts: SalesOrderFilters & { limit: number; offset?: number }): Promise<{ items: any[]; total: number }>
export async function getAllSalesOrders(teamId: string, opts?: SalesOrderFilters): Promise<any[]>
export async function getAllSalesOrders(teamId: string, opts: SalesOrderFilters & { limit?: number; offset?: number } = {}) {
  const db = useDB()

  const ownerUser = alias(user as any, 'ownerUser')
  const createdByUser = alias(user as any, 'createdByUser')
  const updatedByUser = alias(user as any, 'updatedByUser')
  const whereExpr = salesOrderConditions(teamId, opts)

  let listQuery = (db as any)
    .select({
      ...tables.salesOrders,
      eventIdData: eventsSchema.salesEvents,
      clientIdData: clientsSchema.salesClients,
      ownerUser: {
        id: ownerUser.id,
        name: ownerUser.name,
        email: ownerUser.email,
        image: ownerUser.image
      },
      createdByUser: {
        id: createdByUser.id,
        name: createdByUser.name,
        email: createdByUser.email,
        image: createdByUser.image
      },
      updatedByUser: {
        id: updatedByUser.id,
        name: updatedByUser.name,
        email: updatedByUser.email,
        image: updatedByUser.image
      }
    } as any)
    .from(tables.salesOrders)
    .leftJoin(eventsSchema.salesEvents, eq(tables.salesOrders.eventId, eventsSchema.salesEvents.id))
    .leftJoin(clientsSchema.salesClients, eq(tables.salesOrders.clientId, clientsSchema.salesClients.id))
    .leftJoin(ownerUser, eq(tables.salesOrders.owner, ownerUser.id))
    .leftJoin(createdByUser, eq(tables.salesOrders.createdBy, createdByUser.id))
    .leftJoin(updatedByUser, eq(tables.salesOrders.updatedBy, updatedByUser.id))
    .where(whereExpr)
    .orderBy(desc(tables.salesOrders.createdAt))

  if (opts.limit != null) {
    listQuery = listQuery.limit(opts.limit).offset(opts.offset ?? 0)
  }

  const orders = await listQuery

  // Post-query processing for JSON fields (repeater/json types)
  orders.forEach((item: any) => {
      // Parse locationRemarks from JSON string
      if (typeof item.locationRemarks === 'string') {
        try {
          item.locationRemarks = JSON.parse(item.locationRemarks)
        } catch (e) {
          console.error('Error parsing locationRemarks:', e)
          item.locationRemarks = null
        }
      }
      if (item.locationRemarks === null || item.locationRemarks === undefined) {
        item.locationRemarks = null
      }
  })

  if (opts.limit != null) {
    const [countRow] = await (db as any)
      .select({ count: sql`count(*)` })
      .from(tables.salesOrders)
      .where(whereExpr)
    return { items: orders, total: Number(countRow?.count ?? 0) }
  }

  return orders
}

export async function getSalesOrdersByIds(teamId: string, orderIds: string[]) {
  const db = useDB()

  const ownerUser = alias(user as any, 'ownerUser')
  const createdByUser = alias(user as any, 'createdByUser')
  const updatedByUser = alias(user as any, 'updatedByUser')

  const orders = await (db as any)
    .select({
      ...tables.salesOrders,
      eventIdData: eventsSchema.salesEvents,
      clientIdData: clientsSchema.salesClients,
      ownerUser: {
        id: ownerUser.id,
        name: ownerUser.name,
        email: ownerUser.email,
        image: ownerUser.image
      },
      createdByUser: {
        id: createdByUser.id,
        name: createdByUser.name,
        email: createdByUser.email,
        image: createdByUser.image
      },
      updatedByUser: {
        id: updatedByUser.id,
        name: updatedByUser.name,
        email: updatedByUser.email,
        image: updatedByUser.image
      }
    } as any)
    .from(tables.salesOrders)
    .leftJoin(eventsSchema.salesEvents, eq(tables.salesOrders.eventId, eventsSchema.salesEvents.id))
    .leftJoin(clientsSchema.salesClients, eq(tables.salesOrders.clientId, clientsSchema.salesClients.id))
    .leftJoin(ownerUser, eq(tables.salesOrders.owner, ownerUser.id))
    .leftJoin(createdByUser, eq(tables.salesOrders.createdBy, createdByUser.id))
    .leftJoin(updatedByUser, eq(tables.salesOrders.updatedBy, updatedByUser.id))
    .where(
      and(
        eq(tables.salesOrders.teamId, teamId),
        inArray(tables.salesOrders.id, orderIds)
      )
    )
    .orderBy(desc(tables.salesOrders.createdAt))

  // Post-query processing for JSON fields (repeater/json types)
  orders.forEach((item: any) => {
      // Parse locationRemarks from JSON string
      if (typeof item.locationRemarks === 'string') {
        try {
          item.locationRemarks = JSON.parse(item.locationRemarks)
        } catch (e) {
          console.error('Error parsing locationRemarks:', e)
          item.locationRemarks = null
        }
      }
      if (item.locationRemarks === null || item.locationRemarks === undefined) {
        item.locationRemarks = null
      }
  })

  return orders
}

export async function createSalesOrder(data: NewSalesOrder) {
  const db = useDB()

  const [order] = await (db as any)
    .insert(tables.salesOrders)
    .values(data)
    .returning()

  return order
}

export async function updateSalesOrder(
  recordId: string,
  teamId: string,
  userId: string,
  updates: Partial<SalesOrder>,
  options?: { role?: string }
) {
  const db = useDB()
  const isAdmin = options?.role === 'admin' || options?.role === 'owner'

  const conditions = [
    eq(tables.salesOrders.id, recordId),
    eq(tables.salesOrders.teamId, teamId),
  ]
  if (!isAdmin) {
    conditions.push(eq(tables.salesOrders.owner, userId))
  }

  const [order] = await (db as any)
    .update(tables.salesOrders)
    .set({
      ...updates,
      updatedBy: userId
    })
    .where(and(...conditions))
    .returning()

  if (!order) {
    throw createError({
      status: 404,
      statusText: 'SalesOrder not found or unauthorized'
    })
  }

  return order
}

export async function deleteSalesOrder(
  recordId: string,
  teamId: string,
  userId: string,
  options?: { role?: string }
) {
  const db = useDB()
  const isAdmin = options?.role === 'admin' || options?.role === 'owner'

  const conditions = [
    eq(tables.salesOrders.id, recordId),
    eq(tables.salesOrders.teamId, teamId),
  ]
  if (!isAdmin) {
    conditions.push(eq(tables.salesOrders.owner, userId))
  }

  const [deleted] = await (db as any)
    .delete(tables.salesOrders)
    .where(and(...conditions))
    .returning()

  if (!deleted) {
    throw createError({
      status: 404,
      statusText: 'SalesOrder not found or unauthorized'
    })
  }

  return { success: true }
}