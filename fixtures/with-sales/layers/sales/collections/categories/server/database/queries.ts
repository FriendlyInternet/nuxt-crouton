// Generated with JSON field post-processing support (v2025-01-11)
import { eq, and, desc, inArray, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/sqlite-core'
import * as tables from './schema'
import type { SalesCategory, NewSalesCategory } from '../../types'
import * as eventsSchema from '../../../events/server/database/schema'
import { user } from '~~/server/db/schema'

// Overload order matters: the paginated signature (required `limit`) must come
// first so non-paginated calls fall through to the array overload.
export async function getAllSalesCategories(teamId: string, opts: { eventId?: string; limit: number; offset?: number }): Promise<{ items: any[]; total: number }>
export async function getAllSalesCategories(teamId: string, opts?: { eventId?: string }): Promise<any[]>
export async function getAllSalesCategories(teamId: string, opts: { eventId?: string; limit?: number; offset?: number } = {}) {
  const db = useDB()

  const ownerUser = alias(user as any, 'ownerUser')
  const createdByUser = alias(user as any, 'createdByUser')
  const updatedByUser = alias(user as any, 'updatedByUser')
  const conditions = [eq(tables.salesCategories.teamId, teamId)]
  if (opts.eventId) conditions.push(eq(tables.salesCategories.eventId, opts.eventId))
  const whereExpr = and(...conditions)

  let listQuery = (db as any)
    .select({
      ...tables.salesCategories,
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
    .from(tables.salesCategories)
    .leftJoin(eventsSchema.salesEvents, eq(tables.salesCategories.eventId, eventsSchema.salesEvents.id))
    .leftJoin(ownerUser, eq(tables.salesCategories.owner, ownerUser.id))
    .leftJoin(createdByUser, eq(tables.salesCategories.createdBy, createdByUser.id))
    .leftJoin(updatedByUser, eq(tables.salesCategories.updatedBy, updatedByUser.id))
    .where(whereExpr)
    .orderBy(desc(tables.salesCategories.createdAt))

  if (opts.limit != null) {
    listQuery = listQuery.limit(opts.limit).offset(opts.offset ?? 0)
  }

  const categories = await listQuery

  if (opts.limit != null) {
    const [countRow] = await (db as any)
      .select({ count: sql`count(*)` })
      .from(tables.salesCategories)
      .where(whereExpr)
    return { items: categories, total: Number(countRow?.count ?? 0) }
  }

  return categories
}

export async function getSalesCategoriesByIds(teamId: string, categoryIds: string[]) {
  const db = useDB()

  const ownerUser = alias(user as any, 'ownerUser')
  const createdByUser = alias(user as any, 'createdByUser')
  const updatedByUser = alias(user as any, 'updatedByUser')

  const categories = await (db as any)
    .select({
      ...tables.salesCategories,
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
    .from(tables.salesCategories)
    .leftJoin(eventsSchema.salesEvents, eq(tables.salesCategories.eventId, eventsSchema.salesEvents.id))
    .leftJoin(ownerUser, eq(tables.salesCategories.owner, ownerUser.id))
    .leftJoin(createdByUser, eq(tables.salesCategories.createdBy, createdByUser.id))
    .leftJoin(updatedByUser, eq(tables.salesCategories.updatedBy, updatedByUser.id))
    .where(
      and(
        eq(tables.salesCategories.teamId, teamId),
        inArray(tables.salesCategories.id, categoryIds)
      )
    )
    .orderBy(desc(tables.salesCategories.createdAt))

  return categories
}

export async function createSalesCategory(data: NewSalesCategory) {
  const db = useDB()

  const [category] = await (db as any)
    .insert(tables.salesCategories)
    .values(data)
    .returning()

  return category
}

export async function updateSalesCategory(
  recordId: string,
  teamId: string,
  userId: string,
  updates: Partial<SalesCategory>,
  options?: { role?: string }
) {
  const db = useDB()
  const isAdmin = options?.role === 'admin' || options?.role === 'owner'

  const conditions = [
    eq(tables.salesCategories.id, recordId),
    eq(tables.salesCategories.teamId, teamId),
  ]
  if (!isAdmin) {
    conditions.push(eq(tables.salesCategories.owner, userId))
  }

  const [category] = await (db as any)
    .update(tables.salesCategories)
    .set({
      ...updates,
      updatedBy: userId
    })
    .where(and(...conditions))
    .returning()

  if (!category) {
    throw createError({
      status: 404,
      statusText: 'SalesCategory not found or unauthorized'
    })
  }

  return category
}

export async function deleteSalesCategory(
  recordId: string,
  teamId: string,
  userId: string,
  options?: { role?: string }
) {
  const db = useDB()
  const isAdmin = options?.role === 'admin' || options?.role === 'owner'

  const conditions = [
    eq(tables.salesCategories.id, recordId),
    eq(tables.salesCategories.teamId, teamId),
  ]
  if (!isAdmin) {
    conditions.push(eq(tables.salesCategories.owner, userId))
  }

  const [deleted] = await (db as any)
    .delete(tables.salesCategories)
    .where(and(...conditions))
    .returning()

  if (!deleted) {
    throw createError({
      status: 404,
      statusText: 'SalesCategory not found or unauthorized'
    })
  }

  return { success: true }
}