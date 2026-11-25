// Generated with JSON field post-processing support (v2025-01-11)
import { eq, and, desc, inArray, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/sqlite-core'
import * as tables from './schema'
import type { MainCategory, NewMainCategory } from '../../types'
import { user } from '~~/server/db/schema'

// Overload order matters: the paginated signature (required `limit`) must come
// first so non-paginated calls fall through to the array overload.
export async function getAllMainCategories(teamId: string, opts: { owner?: string; createdBy?: string; updatedBy?: string; limit: number; offset?: number }): Promise<{ items: any[]; total: number }>
export async function getAllMainCategories(teamId: string, opts?: { owner?: string; createdBy?: string; updatedBy?: string }): Promise<any[]>
export async function getAllMainCategories(teamId: string, opts: { owner?: string; createdBy?: string; updatedBy?: string; limit?: number; offset?: number } = {}) {
  const db = useDB()

  const ownerUser = alias(user as any, 'ownerUser')
  const createdByUser = alias(user as any, 'createdByUser')
  const updatedByUser = alias(user as any, 'updatedByUser')
  const conditions = [eq(tables.mainCategories.teamId, teamId)]
  if (opts.owner) conditions.push(eq(tables.mainCategories.owner, opts.owner))
  if (opts.createdBy) conditions.push(eq(tables.mainCategories.createdBy, opts.createdBy))
  if (opts.updatedBy) conditions.push(eq(tables.mainCategories.updatedBy, opts.updatedBy))
  const whereExpr = and(...conditions)

  let listQuery = (db as any)
    .select({
      ...tables.mainCategories,
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
    .from(tables.mainCategories)
    .leftJoin(ownerUser, eq(tables.mainCategories.owner, ownerUser.id))
    .leftJoin(createdByUser, eq(tables.mainCategories.createdBy, createdByUser.id))
    .leftJoin(updatedByUser, eq(tables.mainCategories.updatedBy, updatedByUser.id))
    .where(whereExpr)
    .orderBy(desc(tables.mainCategories.createdAt))

  if (opts.limit != null) {
    listQuery = listQuery.limit(opts.limit).offset(opts.offset ?? 0)
  }

  const categories = await listQuery

  if (opts.limit != null) {
    const [countRow] = await (db as any)
      .select({ count: sql`count(*)` })
      .from(tables.mainCategories)
      .where(whereExpr)
    return { items: categories, total: Number(countRow?.count ?? 0) }
  }

  return categories
}

export async function getMainCategoriesByIds(teamId: string, categoryIds: string[]) {
  const db = useDB()

  const ownerUser = alias(user as any, 'ownerUser')
  const createdByUser = alias(user as any, 'createdByUser')
  const updatedByUser = alias(user as any, 'updatedByUser')

  const categories = await (db as any)
    .select({
      ...tables.mainCategories,
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
    .from(tables.mainCategories)
    .leftJoin(ownerUser, eq(tables.mainCategories.owner, ownerUser.id))
    .leftJoin(createdByUser, eq(tables.mainCategories.createdBy, createdByUser.id))
    .leftJoin(updatedByUser, eq(tables.mainCategories.updatedBy, updatedByUser.id))
    .where(
      and(
        eq(tables.mainCategories.teamId, teamId),
        inArray(tables.mainCategories.id, categoryIds)
      )
    )
    .orderBy(desc(tables.mainCategories.createdAt))

  return categories
}

export async function createMainCategory(data: NewMainCategory) {
  const db = useDB()

  const [category] = await (db as any)
    .insert(tables.mainCategories)
    .values(data)
    .returning()

  return category
}

export async function updateMainCategory(
  recordId: string,
  teamId: string,
  userId: string,
  updates: Partial<MainCategory>,
  options?: { seesAll?: boolean }
) {
  const db = useDB()
  const seesAll = options?.seesAll === true

  const conditions = [
    eq(tables.mainCategories.id, recordId),
    eq(tables.mainCategories.teamId, teamId),
  ]
  if (!seesAll) {
    conditions.push(eq(tables.mainCategories.owner, userId))
  }

  const [category] = await (db as any)
    .update(tables.mainCategories)
    .set({
      ...updates,
      updatedBy: userId
    })
    .where(and(...conditions))
    .returning()

  if (!category) {
    throw createError({
      status: 404,
      statusText: 'MainCategory not found or unauthorized'
    })
  }

  return category
}

export async function deleteMainCategory(
  recordId: string,
  teamId: string,
  userId: string,
  options?: { seesAll?: boolean }
) {
  const db = useDB()
  const seesAll = options?.seesAll === true

  const conditions = [
    eq(tables.mainCategories.id, recordId),
    eq(tables.mainCategories.teamId, teamId),
  ]
  if (!seesAll) {
    conditions.push(eq(tables.mainCategories.owner, userId))
  }

  const [deleted] = await (db as any)
    .delete(tables.mainCategories)
    .where(and(...conditions))
    .returning()

  if (!deleted) {
    throw createError({
      status: 404,
      statusText: 'MainCategory not found or unauthorized'
    })
  }

  return { success: true }
}