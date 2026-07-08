// Generated with JSON field post-processing support (v2025-01-11)
import { eq, and, desc, inArray, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/sqlite-core'
import * as tables from './schema'
import type { MainBookmark, NewMainBookmark } from '../../types'
import { user } from '~~/server/db/schema'

// Overload order matters: the paginated signature (required `limit`) must come
// first so non-paginated calls fall through to the array overload.
export async function getAllMainBookmarks(teamId: string, opts: { limit: number; offset?: number }): Promise<{ items: any[]; total: number }>
export async function getAllMainBookmarks(teamId: string, opts?: {}): Promise<any[]>
export async function getAllMainBookmarks(teamId: string, opts: { limit?: number; offset?: number } = {}) {
  const db = useDB()

  const ownerUser = alias(user as any, 'ownerUser')
  const createdByUser = alias(user as any, 'createdByUser')
  const updatedByUser = alias(user as any, 'updatedByUser')
  const conditions = [eq(tables.mainBookmarks.teamId, teamId)]
  const whereExpr = and(...conditions)

  let listQuery = (db as any)
    .select({
      ...tables.mainBookmarks,
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
    .from(tables.mainBookmarks)
    .leftJoin(ownerUser, eq(tables.mainBookmarks.owner, ownerUser.id))
    .leftJoin(createdByUser, eq(tables.mainBookmarks.createdBy, createdByUser.id))
    .leftJoin(updatedByUser, eq(tables.mainBookmarks.updatedBy, updatedByUser.id))
    .where(whereExpr)
    .orderBy(desc(tables.mainBookmarks.createdAt))

  if (opts.limit != null) {
    listQuery = listQuery.limit(opts.limit).offset(opts.offset ?? 0)
  }

  const bookmarks = await listQuery

  if (opts.limit != null) {
    const [countRow] = await (db as any)
      .select({ count: sql`count(*)` })
      .from(tables.mainBookmarks)
      .where(whereExpr)
    return { items: bookmarks, total: Number(countRow?.count ?? 0) }
  }

  return bookmarks
}

export async function getMainBookmarksByIds(teamId: string, bookmarkIds: string[]) {
  const db = useDB()

  const ownerUser = alias(user as any, 'ownerUser')
  const createdByUser = alias(user as any, 'createdByUser')
  const updatedByUser = alias(user as any, 'updatedByUser')

  const bookmarks = await (db as any)
    .select({
      ...tables.mainBookmarks,
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
    .from(tables.mainBookmarks)
    .leftJoin(ownerUser, eq(tables.mainBookmarks.owner, ownerUser.id))
    .leftJoin(createdByUser, eq(tables.mainBookmarks.createdBy, createdByUser.id))
    .leftJoin(updatedByUser, eq(tables.mainBookmarks.updatedBy, updatedByUser.id))
    .where(
      and(
        eq(tables.mainBookmarks.teamId, teamId),
        inArray(tables.mainBookmarks.id, bookmarkIds)
      )
    )
    .orderBy(desc(tables.mainBookmarks.createdAt))

  return bookmarks
}

export async function createMainBookmark(data: NewMainBookmark) {
  const db = useDB()

  const [bookmark] = await (db as any)
    .insert(tables.mainBookmarks)
    .values(data)
    .returning()

  return bookmark
}

export async function updateMainBookmark(
  recordId: string,
  teamId: string,
  userId: string,
  updates: Partial<MainBookmark>,
  options?: { role?: string }
) {
  const db = useDB()
  const isAdmin = options?.role === 'admin' || options?.role === 'owner'

  const conditions = [
    eq(tables.mainBookmarks.id, recordId),
    eq(tables.mainBookmarks.teamId, teamId),
  ]
  if (!isAdmin) {
    conditions.push(eq(tables.mainBookmarks.owner, userId))
  }

  const [bookmark] = await (db as any)
    .update(tables.mainBookmarks)
    .set({
      ...updates,
      updatedBy: userId
    })
    .where(and(...conditions))
    .returning()

  if (!bookmark) {
    throw createError({
      status: 404,
      statusText: 'MainBookmark not found or unauthorized'
    })
  }

  return bookmark
}

export async function deleteMainBookmark(
  recordId: string,
  teamId: string,
  userId: string,
  options?: { role?: string }
) {
  const db = useDB()
  const isAdmin = options?.role === 'admin' || options?.role === 'owner'

  const conditions = [
    eq(tables.mainBookmarks.id, recordId),
    eq(tables.mainBookmarks.teamId, teamId),
  ]
  if (!isAdmin) {
    conditions.push(eq(tables.mainBookmarks.owner, userId))
  }

  const [deleted] = await (db as any)
    .delete(tables.mainBookmarks)
    .where(and(...conditions))
    .returning()

  if (!deleted) {
    throw createError({
      status: 404,
      statusText: 'MainBookmark not found or unauthorized'
    })
  }

  return { success: true }
}