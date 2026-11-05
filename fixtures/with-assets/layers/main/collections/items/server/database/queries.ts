// Generated with JSON field post-processing support (v2025-01-11)
import { eq, and, desc, inArray, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/sqlite-core'
import * as tables from './schema'
import type { MainItem, NewMainItem } from '../../types'
import { user } from '~~/server/db/schema'

// Overload order matters: the paginated signature (required `limit`) must come
// first so non-paginated calls fall through to the array overload.
export async function getAllMainItems(teamId: string, opts: { owner?: string; createdBy?: string; updatedBy?: string; limit: number; offset?: number }): Promise<{ items: any[]; total: number }>
export async function getAllMainItems(teamId: string, opts?: { owner?: string; createdBy?: string; updatedBy?: string }): Promise<any[]>
export async function getAllMainItems(teamId: string, opts: { owner?: string; createdBy?: string; updatedBy?: string; limit?: number; offset?: number } = {}) {
  const db = useDB()

  const ownerUser = alias(user as any, 'ownerUser')
  const createdByUser = alias(user as any, 'createdByUser')
  const updatedByUser = alias(user as any, 'updatedByUser')
  const conditions = [eq(tables.mainItems.teamId, teamId)]
  if (opts.owner) conditions.push(eq(tables.mainItems.owner, opts.owner))
  if (opts.createdBy) conditions.push(eq(tables.mainItems.createdBy, opts.createdBy))
  if (opts.updatedBy) conditions.push(eq(tables.mainItems.updatedBy, opts.updatedBy))
  const whereExpr = and(...conditions)

  let listQuery = (db as any)
    .select({
      ...tables.mainItems,
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
    .from(tables.mainItems)
    .leftJoin(ownerUser, eq(tables.mainItems.owner, ownerUser.id))
    .leftJoin(createdByUser, eq(tables.mainItems.createdBy, createdByUser.id))
    .leftJoin(updatedByUser, eq(tables.mainItems.updatedBy, updatedByUser.id))
    .where(whereExpr)
    .orderBy(desc(tables.mainItems.createdAt))

  if (opts.limit != null) {
    listQuery = listQuery.limit(opts.limit).offset(opts.offset ?? 0)
  }

  const items = await listQuery

  if (opts.limit != null) {
    const [countRow] = await (db as any)
      .select({ count: sql`count(*)` })
      .from(tables.mainItems)
      .where(whereExpr)
    return { items: items, total: Number(countRow?.count ?? 0) }
  }

  return items
}

export async function getMainItemsByIds(teamId: string, itemIds: string[]) {
  const db = useDB()

  const ownerUser = alias(user as any, 'ownerUser')
  const createdByUser = alias(user as any, 'createdByUser')
  const updatedByUser = alias(user as any, 'updatedByUser')

  const items = await (db as any)
    .select({
      ...tables.mainItems,
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
    .from(tables.mainItems)
    .leftJoin(ownerUser, eq(tables.mainItems.owner, ownerUser.id))
    .leftJoin(createdByUser, eq(tables.mainItems.createdBy, createdByUser.id))
    .leftJoin(updatedByUser, eq(tables.mainItems.updatedBy, updatedByUser.id))
    .where(
      and(
        eq(tables.mainItems.teamId, teamId),
        inArray(tables.mainItems.id, itemIds)
      )
    )
    .orderBy(desc(tables.mainItems.createdAt))

  return items
}

export async function createMainItem(data: NewMainItem) {
  const db = useDB()

  const [item] = await (db as any)
    .insert(tables.mainItems)
    .values(data)
    .returning()

  return item
}

export async function updateMainItem(
  recordId: string,
  teamId: string,
  userId: string,
  updates: Partial<MainItem>,
  options?: { role?: string }
) {
  const db = useDB()
  const isAdmin = options?.role === 'admin' || options?.role === 'owner'

  const conditions = [
    eq(tables.mainItems.id, recordId),
    eq(tables.mainItems.teamId, teamId),
  ]
  if (!isAdmin) {
    conditions.push(eq(tables.mainItems.owner, userId))
  }

  const [item] = await (db as any)
    .update(tables.mainItems)
    .set({
      ...updates,
      updatedBy: userId
    })
    .where(and(...conditions))
    .returning()

  if (!item) {
    throw createError({
      status: 404,
      statusText: 'MainItem not found or unauthorized'
    })
  }

  return item
}

export async function deleteMainItem(
  recordId: string,
  teamId: string,
  userId: string,
  options?: { role?: string }
) {
  const db = useDB()
  const isAdmin = options?.role === 'admin' || options?.role === 'owner'

  const conditions = [
    eq(tables.mainItems.id, recordId),
    eq(tables.mainItems.teamId, teamId),
  ]
  if (!isAdmin) {
    conditions.push(eq(tables.mainItems.owner, userId))
  }

  const [deleted] = await (db as any)
    .delete(tables.mainItems)
    .where(and(...conditions))
    .returning()

  if (!deleted) {
    throw createError({
      status: 404,
      statusText: 'MainItem not found or unauthorized'
    })
  }

  return { success: true }
}