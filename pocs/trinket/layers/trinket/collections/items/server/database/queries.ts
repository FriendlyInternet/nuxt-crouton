// Generated with JSON field post-processing support (v2025-01-11)
import { eq, and, desc, inArray, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/sqlite-core'
import * as tables from './schema'
import type { TrinketItem, NewTrinketItem } from '../../types'
import { user } from '~~/server/db/schema'

// Overload order matters: the paginated signature (required `limit`) must come
// first so non-paginated calls fall through to the array overload.
export async function getAllTrinketItems(teamId: string, opts: { limit: number; offset?: number }): Promise<{ items: any[]; total: number }>
export async function getAllTrinketItems(teamId: string, opts?: {}): Promise<any[]>
export async function getAllTrinketItems(teamId: string, opts: { limit?: number; offset?: number } = {}) {
  const db = useDB()

  const ownerUser = alias(user as any, 'ownerUser')
  const createdByUser = alias(user as any, 'createdByUser')
  const updatedByUser = alias(user as any, 'updatedByUser')
  const conditions = [eq(tables.trinketItems.teamId, teamId)]
  const whereExpr = and(...conditions)

  let listQuery = (db as any)
    .select({
      ...tables.trinketItems,
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
    .from(tables.trinketItems)
    .leftJoin(ownerUser, eq(tables.trinketItems.owner, ownerUser.id))
    .leftJoin(createdByUser, eq(tables.trinketItems.createdBy, createdByUser.id))
    .leftJoin(updatedByUser, eq(tables.trinketItems.updatedBy, updatedByUser.id))
    .where(whereExpr)
    .orderBy(desc(tables.trinketItems.createdAt))

  if (opts.limit != null) {
    listQuery = listQuery.limit(opts.limit).offset(opts.offset ?? 0)
  }

  const items = await listQuery

  if (opts.limit != null) {
    const [countRow] = await (db as any)
      .select({ count: sql`count(*)` })
      .from(tables.trinketItems)
      .where(whereExpr)
    return { items: items, total: Number(countRow?.count ?? 0) }
  }

  return items
}

export async function getTrinketItemsByIds(teamId: string, itemIds: string[]) {
  const db = useDB()

  const ownerUser = alias(user as any, 'ownerUser')
  const createdByUser = alias(user as any, 'createdByUser')
  const updatedByUser = alias(user as any, 'updatedByUser')

  const items = await (db as any)
    .select({
      ...tables.trinketItems,
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
    .from(tables.trinketItems)
    .leftJoin(ownerUser, eq(tables.trinketItems.owner, ownerUser.id))
    .leftJoin(createdByUser, eq(tables.trinketItems.createdBy, createdByUser.id))
    .leftJoin(updatedByUser, eq(tables.trinketItems.updatedBy, updatedByUser.id))
    .where(
      and(
        eq(tables.trinketItems.teamId, teamId),
        inArray(tables.trinketItems.id, itemIds)
      )
    )
    .orderBy(desc(tables.trinketItems.createdAt))

  return items
}

export async function createTrinketItem(data: NewTrinketItem) {
  const db = useDB()

  const [item] = await (db as any)
    .insert(tables.trinketItems)
    .values(data)
    .returning()

  return item
}

export async function updateTrinketItem(
  recordId: string,
  teamId: string,
  userId: string,
  updates: Partial<TrinketItem>,
  options?: { role?: string }
) {
  const db = useDB()
  const isAdmin = options?.role === 'admin' || options?.role === 'owner'

  const conditions = [
    eq(tables.trinketItems.id, recordId),
    eq(tables.trinketItems.teamId, teamId),
  ]
  if (!isAdmin) {
    conditions.push(eq(tables.trinketItems.owner, userId))
  }

  const [item] = await (db as any)
    .update(tables.trinketItems)
    .set({
      ...updates,
      updatedBy: userId
    })
    .where(and(...conditions))
    .returning()

  if (!item) {
    throw createError({
      status: 404,
      statusText: 'TrinketItem not found or unauthorized'
    })
  }

  return item
}

export async function deleteTrinketItem(
  recordId: string,
  teamId: string,
  userId: string,
  options?: { role?: string }
) {
  const db = useDB()
  const isAdmin = options?.role === 'admin' || options?.role === 'owner'

  const conditions = [
    eq(tables.trinketItems.id, recordId),
    eq(tables.trinketItems.teamId, teamId),
  ]
  if (!isAdmin) {
    conditions.push(eq(tables.trinketItems.owner, userId))
  }

  const [deleted] = await (db as any)
    .delete(tables.trinketItems)
    .where(and(...conditions))
    .returning()

  if (!deleted) {
    throw createError({
      status: 404,
      statusText: 'TrinketItem not found or unauthorized'
    })
  }

  return { success: true }
}