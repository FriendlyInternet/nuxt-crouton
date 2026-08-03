// Generated with JSON field post-processing support (v2025-01-11)
import { eq, and, desc, inArray, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/sqlite-core'
import * as tables from './schema'
import type { SalesHandover, NewSalesHandover } from '../../types'
import * as eventsSchema from '../../../events/server/database/schema'
import * as ordersSchema from '../../../orders/server/database/schema'
import { user } from '~~/server/db/schema'

// Overload order matters: the paginated signature (required `limit`) must come
// first so non-paginated calls fall through to the array overload.
export async function getAllSalesHandovers(teamId: string, opts: { eventId?: string; orderId?: string; limit: number; offset?: number }): Promise<{ items: any[]; total: number }>
export async function getAllSalesHandovers(teamId: string, opts?: { eventId?: string; orderId?: string }): Promise<any[]>
export async function getAllSalesHandovers(teamId: string, opts: { eventId?: string; orderId?: string; limit?: number; offset?: number } = {}) {
  const db = useDB()

  const ownerUser = alias(user as any, 'ownerUser')
  const createdByUser = alias(user as any, 'createdByUser')
  const updatedByUser = alias(user as any, 'updatedByUser')
  const conditions = [eq(tables.salesHandovers.teamId, teamId)]
  if (opts.eventId) conditions.push(eq(tables.salesHandovers.eventId, opts.eventId))
  if (opts.orderId) conditions.push(eq(tables.salesHandovers.orderId, opts.orderId))
  const whereExpr = and(...conditions)

  let listQuery = (db as any)
    .select({
      ...tables.salesHandovers,
      eventIdData: eventsSchema.salesEvents,
      orderIdData: ordersSchema.salesOrders,
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
    .from(tables.salesHandovers)
    .leftJoin(eventsSchema.salesEvents, eq(tables.salesHandovers.eventId, eventsSchema.salesEvents.id))
    .leftJoin(ordersSchema.salesOrders, eq(tables.salesHandovers.orderId, ordersSchema.salesOrders.id))
    .leftJoin(ownerUser, eq(tables.salesHandovers.owner, ownerUser.id))
    .leftJoin(createdByUser, eq(tables.salesHandovers.createdBy, createdByUser.id))
    .leftJoin(updatedByUser, eq(tables.salesHandovers.updatedBy, updatedByUser.id))
    .where(whereExpr)
    .orderBy(desc(tables.salesHandovers.createdAt))

  if (opts.limit != null) {
    listQuery = listQuery.limit(opts.limit).offset(opts.offset ?? 0)
  }

  const handovers = await listQuery

  if (opts.limit != null) {
    const [countRow] = await (db as any)
      .select({ count: sql`count(*)` })
      .from(tables.salesHandovers)
      .where(whereExpr)
    return { items: handovers, total: Number(countRow?.count ?? 0) }
  }

  return handovers
}

export async function getSalesHandoversByIds(teamId: string, handoverIds: string[]) {
  const db = useDB()

  const ownerUser = alias(user as any, 'ownerUser')
  const createdByUser = alias(user as any, 'createdByUser')
  const updatedByUser = alias(user as any, 'updatedByUser')

  const handovers = await (db as any)
    .select({
      ...tables.salesHandovers,
      eventIdData: eventsSchema.salesEvents,
      orderIdData: ordersSchema.salesOrders,
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
    .from(tables.salesHandovers)
    .leftJoin(eventsSchema.salesEvents, eq(tables.salesHandovers.eventId, eventsSchema.salesEvents.id))
    .leftJoin(ordersSchema.salesOrders, eq(tables.salesHandovers.orderId, ordersSchema.salesOrders.id))
    .leftJoin(ownerUser, eq(tables.salesHandovers.owner, ownerUser.id))
    .leftJoin(createdByUser, eq(tables.salesHandovers.createdBy, createdByUser.id))
    .leftJoin(updatedByUser, eq(tables.salesHandovers.updatedBy, updatedByUser.id))
    .where(
      and(
        eq(tables.salesHandovers.teamId, teamId),
        inArray(tables.salesHandovers.id, handoverIds)
      )
    )
    .orderBy(desc(tables.salesHandovers.createdAt))

  return handovers
}

export async function createSalesHandover(data: NewSalesHandover) {
  const db = useDB()

  const [handover] = await (db as any)
    .insert(tables.salesHandovers)
    .values(data)
    .returning()

  return handover
}

export async function updateSalesHandover(
  recordId: string,
  teamId: string,
  userId: string,
  updates: Partial<SalesHandover>,
  options?: { role?: string }
) {
  const db = useDB()
  const isAdmin = options?.role === 'admin' || options?.role === 'owner'

  const conditions = [
    eq(tables.salesHandovers.id, recordId),
    eq(tables.salesHandovers.teamId, teamId),
  ]
  if (!isAdmin) {
    conditions.push(eq(tables.salesHandovers.owner, userId))
  }

  const [handover] = await (db as any)
    .update(tables.salesHandovers)
    .set({
      ...updates,
      updatedBy: userId
    })
    .where(and(...conditions))
    .returning()

  if (!handover) {
    throw createError({
      status: 404,
      statusText: 'SalesHandover not found or unauthorized'
    })
  }

  return handover
}

export async function deleteSalesHandover(
  recordId: string,
  teamId: string,
  userId: string,
  options?: { role?: string }
) {
  const db = useDB()
  const isAdmin = options?.role === 'admin' || options?.role === 'owner'

  const conditions = [
    eq(tables.salesHandovers.id, recordId),
    eq(tables.salesHandovers.teamId, teamId),
  ]
  if (!isAdmin) {
    conditions.push(eq(tables.salesHandovers.owner, userId))
  }

  const [deleted] = await (db as any)
    .delete(tables.salesHandovers)
    .where(and(...conditions))
    .returning()

  if (!deleted) {
    throw createError({
      status: 404,
      statusText: 'SalesHandover not found or unauthorized'
    })
  }

  return { success: true }
}