// Generated with JSON field post-processing support (v2025-01-11)
import { eq, and, desc, inArray, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/sqlite-core'
import * as tables from './schema'
import type { SalesKdsbump, NewSalesKdsbump } from '../../types'
import * as eventsSchema from '../../../events/server/database/schema'
import * as ordersSchema from '../../../orders/server/database/schema'
import * as locationsSchema from '../../../locations/server/database/schema'
import { user } from '~~/server/db/schema'

// Overload order matters: the paginated signature (required `limit`) must come
// first so non-paginated calls fall through to the array overload.
export async function getAllSalesKdsbumps(teamId: string, opts: { eventId?: string; orderId?: string; locationId?: string; limit: number; offset?: number }): Promise<{ items: any[]; total: number }>
export async function getAllSalesKdsbumps(teamId: string, opts?: { eventId?: string; orderId?: string; locationId?: string }): Promise<any[]>
export async function getAllSalesKdsbumps(teamId: string, opts: { eventId?: string; orderId?: string; locationId?: string; limit?: number; offset?: number } = {}) {
  const db = useDB()

  const ownerUser = alias(user as any, 'ownerUser')
  const createdByUser = alias(user as any, 'createdByUser')
  const updatedByUser = alias(user as any, 'updatedByUser')
  const conditions = [eq(tables.salesKdsbumps.teamId, teamId)]
  if (opts.eventId) conditions.push(eq(tables.salesKdsbumps.eventId, opts.eventId))
  if (opts.orderId) conditions.push(eq(tables.salesKdsbumps.orderId, opts.orderId))
  if (opts.locationId) conditions.push(eq(tables.salesKdsbumps.locationId, opts.locationId))
  const whereExpr = and(...conditions)

  let listQuery = (db as any)
    .select({
      ...tables.salesKdsbumps,
      eventIdData: eventsSchema.salesEvents,
      orderIdData: ordersSchema.salesOrders,
      locationIdData: locationsSchema.salesLocations,
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
    .from(tables.salesKdsbumps)
    .leftJoin(eventsSchema.salesEvents, eq(tables.salesKdsbumps.eventId, eventsSchema.salesEvents.id))
    .leftJoin(ordersSchema.salesOrders, eq(tables.salesKdsbumps.orderId, ordersSchema.salesOrders.id))
    .leftJoin(locationsSchema.salesLocations, eq(tables.salesKdsbumps.locationId, locationsSchema.salesLocations.id))
    .leftJoin(ownerUser, eq(tables.salesKdsbumps.owner, ownerUser.id))
    .leftJoin(createdByUser, eq(tables.salesKdsbumps.createdBy, createdByUser.id))
    .leftJoin(updatedByUser, eq(tables.salesKdsbumps.updatedBy, updatedByUser.id))
    .where(whereExpr)
    .orderBy(desc(tables.salesKdsbumps.createdAt))

  if (opts.limit != null) {
    listQuery = listQuery.limit(opts.limit).offset(opts.offset ?? 0)
  }

  const kdsbumps = await listQuery

  if (opts.limit != null) {
    const [countRow] = await (db as any)
      .select({ count: sql`count(*)` })
      .from(tables.salesKdsbumps)
      .where(whereExpr)
    return { items: kdsbumps, total: Number(countRow?.count ?? 0) }
  }

  return kdsbumps
}

export async function getSalesKdsbumpsByIds(teamId: string, kdsbumpIds: string[]) {
  const db = useDB()

  const ownerUser = alias(user as any, 'ownerUser')
  const createdByUser = alias(user as any, 'createdByUser')
  const updatedByUser = alias(user as any, 'updatedByUser')

  const kdsbumps = await (db as any)
    .select({
      ...tables.salesKdsbumps,
      eventIdData: eventsSchema.salesEvents,
      orderIdData: ordersSchema.salesOrders,
      locationIdData: locationsSchema.salesLocations,
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
    .from(tables.salesKdsbumps)
    .leftJoin(eventsSchema.salesEvents, eq(tables.salesKdsbumps.eventId, eventsSchema.salesEvents.id))
    .leftJoin(ordersSchema.salesOrders, eq(tables.salesKdsbumps.orderId, ordersSchema.salesOrders.id))
    .leftJoin(locationsSchema.salesLocations, eq(tables.salesKdsbumps.locationId, locationsSchema.salesLocations.id))
    .leftJoin(ownerUser, eq(tables.salesKdsbumps.owner, ownerUser.id))
    .leftJoin(createdByUser, eq(tables.salesKdsbumps.createdBy, createdByUser.id))
    .leftJoin(updatedByUser, eq(tables.salesKdsbumps.updatedBy, updatedByUser.id))
    .where(
      and(
        eq(tables.salesKdsbumps.teamId, teamId),
        inArray(tables.salesKdsbumps.id, kdsbumpIds)
      )
    )
    .orderBy(desc(tables.salesKdsbumps.createdAt))

  return kdsbumps
}

export async function createSalesKdsbump(data: NewSalesKdsbump) {
  const db = useDB()

  const [kdsbump] = await (db as any)
    .insert(tables.salesKdsbumps)
    .values(data)
    .returning()

  return kdsbump
}

export async function updateSalesKdsbump(
  recordId: string,
  teamId: string,
  userId: string,
  updates: Partial<SalesKdsbump>,
  options?: { role?: string }
) {
  const db = useDB()
  const isAdmin = options?.role === 'admin' || options?.role === 'owner'

  const conditions = [
    eq(tables.salesKdsbumps.id, recordId),
    eq(tables.salesKdsbumps.teamId, teamId),
  ]
  if (!isAdmin) {
    conditions.push(eq(tables.salesKdsbumps.owner, userId))
  }

  const [kdsbump] = await (db as any)
    .update(tables.salesKdsbumps)
    .set({
      ...updates,
      updatedBy: userId
    })
    .where(and(...conditions))
    .returning()

  if (!kdsbump) {
    throw createError({
      status: 404,
      statusText: 'SalesKdsbump not found or unauthorized'
    })
  }

  return kdsbump
}

export async function deleteSalesKdsbump(
  recordId: string,
  teamId: string,
  userId: string,
  options?: { role?: string }
) {
  const db = useDB()
  const isAdmin = options?.role === 'admin' || options?.role === 'owner'

  const conditions = [
    eq(tables.salesKdsbumps.id, recordId),
    eq(tables.salesKdsbumps.teamId, teamId),
  ]
  if (!isAdmin) {
    conditions.push(eq(tables.salesKdsbumps.owner, userId))
  }

  const [deleted] = await (db as any)
    .delete(tables.salesKdsbumps)
    .where(and(...conditions))
    .returning()

  if (!deleted) {
    throw createError({
      status: 404,
      statusText: 'SalesKdsbump not found or unauthorized'
    })
  }

  return { success: true }
}