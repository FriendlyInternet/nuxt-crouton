// Generated with JSON field post-processing support (v2025-01-11)
import { eq, and, desc, inArray, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/sqlite-core'
import * as tables from './schema'
import type { SalesLocation, NewSalesLocation } from '../../types'
import * as eventsSchema from '../../../events/server/database/schema'
import { user } from '~~/server/db/schema'

// Overload order matters: the paginated signature (required `limit`) must come
// first so non-paginated calls fall through to the array overload.
export async function getAllSalesLocations(teamId: string, opts: { eventId?: string; limit: number; offset?: number }): Promise<{ items: any[]; total: number }>
export async function getAllSalesLocations(teamId: string, opts?: { eventId?: string }): Promise<any[]>
export async function getAllSalesLocations(teamId: string, opts: { eventId?: string; limit?: number; offset?: number } = {}) {
  const db = useDB()

  const ownerUser = alias(user as any, 'ownerUser')
  const createdByUser = alias(user as any, 'createdByUser')
  const updatedByUser = alias(user as any, 'updatedByUser')
  const conditions = [eq(tables.salesLocations.teamId, teamId)]
  if (opts.eventId) conditions.push(eq(tables.salesLocations.eventId, opts.eventId))
  const whereExpr = and(...conditions)

  let listQuery = (db as any)
    .select({
      ...tables.salesLocations,
      eventIdData: eventsSchema.salesEvents,
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
    .from(tables.salesLocations)
    .leftJoin(eventsSchema.salesEvents, eq(tables.salesLocations.eventId, eventsSchema.salesEvents.id))
    .leftJoin(ownerUser, eq(tables.salesLocations.owner, ownerUser.id))
    .leftJoin(createdByUser, eq(tables.salesLocations.createdBy, createdByUser.id))
    .leftJoin(updatedByUser, eq(tables.salesLocations.updatedBy, updatedByUser.id))
    .where(whereExpr)
    .orderBy(desc(tables.salesLocations.createdAt))

  if (opts.limit != null) {
    listQuery = listQuery.limit(opts.limit).offset(opts.offset ?? 0)
  }

  const locations = await listQuery

  if (opts.limit != null) {
    const [countRow] = await (db as any)
      .select({ count: sql`count(*)` })
      .from(tables.salesLocations)
      .where(whereExpr)
    return { items: locations, total: Number(countRow?.count ?? 0) }
  }

  return locations
}

export async function getSalesLocationsByIds(teamId: string, locationIds: string[]) {
  const db = useDB()

  const ownerUser = alias(user as any, 'ownerUser')
  const createdByUser = alias(user as any, 'createdByUser')
  const updatedByUser = alias(user as any, 'updatedByUser')

  const locations = await (db as any)
    .select({
      ...tables.salesLocations,
      eventIdData: eventsSchema.salesEvents,
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
    .from(tables.salesLocations)
    .leftJoin(eventsSchema.salesEvents, eq(tables.salesLocations.eventId, eventsSchema.salesEvents.id))
    .leftJoin(ownerUser, eq(tables.salesLocations.owner, ownerUser.id))
    .leftJoin(createdByUser, eq(tables.salesLocations.createdBy, createdByUser.id))
    .leftJoin(updatedByUser, eq(tables.salesLocations.updatedBy, updatedByUser.id))
    .where(
      and(
        eq(tables.salesLocations.teamId, teamId),
        inArray(tables.salesLocations.id, locationIds)
      )
    )
    .orderBy(desc(tables.salesLocations.createdAt))

  return locations
}

export async function createSalesLocation(data: NewSalesLocation) {
  const db = useDB()

  const [location] = await (db as any)
    .insert(tables.salesLocations)
    .values(data)
    .returning()

  return location
}

export async function updateSalesLocation(
  recordId: string,
  teamId: string,
  userId: string,
  updates: Partial<SalesLocation>,
  options?: { role?: string }
) {
  const db = useDB()
  const isAdmin = options?.role === 'admin' || options?.role === 'owner'

  const conditions = [
    eq(tables.salesLocations.id, recordId),
    eq(tables.salesLocations.teamId, teamId),
  ]
  if (!isAdmin) {
    conditions.push(eq(tables.salesLocations.owner, userId))
  }

  const [location] = await (db as any)
    .update(tables.salesLocations)
    .set({
      ...updates,
      updatedBy: userId
    })
    .where(and(...conditions))
    .returning()

  if (!location) {
    throw createError({
      status: 404,
      statusText: 'SalesLocation not found or unauthorized'
    })
  }

  return location
}

export async function deleteSalesLocation(
  recordId: string,
  teamId: string,
  userId: string,
  options?: { role?: string }
) {
  const db = useDB()
  const isAdmin = options?.role === 'admin' || options?.role === 'owner'

  const conditions = [
    eq(tables.salesLocations.id, recordId),
    eq(tables.salesLocations.teamId, teamId),
  ]
  if (!isAdmin) {
    conditions.push(eq(tables.salesLocations.owner, userId))
  }

  const [deleted] = await (db as any)
    .delete(tables.salesLocations)
    .where(and(...conditions))
    .returning()

  if (!deleted) {
    throw createError({
      status: 404,
      statusText: 'SalesLocation not found or unauthorized'
    })
  }

  return { success: true }
}