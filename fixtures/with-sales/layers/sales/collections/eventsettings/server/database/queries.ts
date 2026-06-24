// Generated with JSON field post-processing support (v2025-01-11)
import { eq, and, desc, inArray, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/sqlite-core'
import * as tables from './schema'
import type { SalesEventsetting, NewSalesEventsetting } from '../../types'
import * as eventsSchema from '../../../events/server/database/schema'
import { user } from '~~/server/db/schema'

// Overload order matters: the paginated signature (required `limit`) must come
// first so non-paginated calls fall through to the array overload.
export async function getAllSalesEventsettings(teamId: string, opts: { eventId?: string; limit: number; offset?: number }): Promise<{ items: any[]; total: number }>
export async function getAllSalesEventsettings(teamId: string, opts?: { eventId?: string }): Promise<any[]>
export async function getAllSalesEventsettings(teamId: string, opts: { eventId?: string; limit?: number; offset?: number } = {}) {
  const db = useDB()

  const ownerUser = alias(user as any, 'ownerUser')
  const createdByUser = alias(user as any, 'createdByUser')
  const updatedByUser = alias(user as any, 'updatedByUser')
  const conditions = [eq(tables.salesEventsettings.teamId, teamId)]
  if (opts.eventId) conditions.push(eq(tables.salesEventsettings.eventId, opts.eventId))
  const whereExpr = and(...conditions)

  let listQuery = (db as any)
    .select({
      ...tables.salesEventsettings,
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
    .from(tables.salesEventsettings)
    .leftJoin(eventsSchema.salesEvents, eq(tables.salesEventsettings.eventId, eventsSchema.salesEvents.id))
    .leftJoin(ownerUser, eq(tables.salesEventsettings.owner, ownerUser.id))
    .leftJoin(createdByUser, eq(tables.salesEventsettings.createdBy, createdByUser.id))
    .leftJoin(updatedByUser, eq(tables.salesEventsettings.updatedBy, updatedByUser.id))
    .where(whereExpr)
    .orderBy(desc(tables.salesEventsettings.createdAt))

  if (opts.limit != null) {
    listQuery = listQuery.limit(opts.limit).offset(opts.offset ?? 0)
  }

  const eventsettings = await listQuery

  if (opts.limit != null) {
    const [countRow] = await (db as any)
      .select({ count: sql`count(*)` })
      .from(tables.salesEventsettings)
      .where(whereExpr)
    return { items: eventsettings, total: Number(countRow?.count ?? 0) }
  }

  return eventsettings
}

export async function getSalesEventsettingsByIds(teamId: string, eventsettingIds: string[]) {
  const db = useDB()

  const ownerUser = alias(user as any, 'ownerUser')
  const createdByUser = alias(user as any, 'createdByUser')
  const updatedByUser = alias(user as any, 'updatedByUser')

  const eventsettings = await (db as any)
    .select({
      ...tables.salesEventsettings,
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
    .from(tables.salesEventsettings)
    .leftJoin(eventsSchema.salesEvents, eq(tables.salesEventsettings.eventId, eventsSchema.salesEvents.id))
    .leftJoin(ownerUser, eq(tables.salesEventsettings.owner, ownerUser.id))
    .leftJoin(createdByUser, eq(tables.salesEventsettings.createdBy, createdByUser.id))
    .leftJoin(updatedByUser, eq(tables.salesEventsettings.updatedBy, updatedByUser.id))
    .where(
      and(
        eq(tables.salesEventsettings.teamId, teamId),
        inArray(tables.salesEventsettings.id, eventsettingIds)
      )
    )
    .orderBy(desc(tables.salesEventsettings.createdAt))

  return eventsettings
}

export async function createSalesEventsetting(data: NewSalesEventsetting) {
  const db = useDB()

  const [eventsetting] = await (db as any)
    .insert(tables.salesEventsettings)
    .values(data)
    .returning()

  return eventsetting
}

export async function updateSalesEventsetting(
  recordId: string,
  teamId: string,
  userId: string,
  updates: Partial<SalesEventsetting>,
  options?: { role?: string }
) {
  const db = useDB()
  const isAdmin = options?.role === 'admin' || options?.role === 'owner'

  const conditions = [
    eq(tables.salesEventsettings.id, recordId),
    eq(tables.salesEventsettings.teamId, teamId),
  ]
  if (!isAdmin) {
    conditions.push(eq(tables.salesEventsettings.owner, userId))
  }

  const [eventsetting] = await (db as any)
    .update(tables.salesEventsettings)
    .set({
      ...updates,
      updatedBy: userId
    })
    .where(and(...conditions))
    .returning()

  if (!eventsetting) {
    throw createError({
      status: 404,
      statusText: 'SalesEventsetting not found or unauthorized'
    })
  }

  return eventsetting
}

export async function deleteSalesEventsetting(
  recordId: string,
  teamId: string,
  userId: string,
  options?: { role?: string }
) {
  const db = useDB()
  const isAdmin = options?.role === 'admin' || options?.role === 'owner'

  const conditions = [
    eq(tables.salesEventsettings.id, recordId),
    eq(tables.salesEventsettings.teamId, teamId),
  ]
  if (!isAdmin) {
    conditions.push(eq(tables.salesEventsettings.owner, userId))
  }

  const [deleted] = await (db as any)
    .delete(tables.salesEventsettings)
    .where(and(...conditions))
    .returning()

  if (!deleted) {
    throw createError({
      status: 404,
      statusText: 'SalesEventsetting not found or unauthorized'
    })
  }

  return { success: true }
}