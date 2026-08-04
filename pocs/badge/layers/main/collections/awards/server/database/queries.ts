// Generated with JSON field post-processing support (v2025-01-11)
import { eq, and, desc, inArray, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/sqlite-core'
import * as tables from './schema'
import type { MainAward, NewMainAward } from '../../types'
import { user } from '~~/server/db/schema'

// Overload order matters: the paginated signature (required `limit`) must come
// first so non-paginated calls fall through to the array overload.
export async function getAllMainAwards(teamId: string, opts: { limit: number; offset?: number }): Promise<{ items: any[]; total: number }>
export async function getAllMainAwards(teamId: string, opts?: {}): Promise<any[]>
export async function getAllMainAwards(teamId: string, opts: { limit?: number; offset?: number } = {}) {
  const db = useDB()

  const ownerUser = alias(user as any, 'ownerUser')
  const createdByUser = alias(user as any, 'createdByUser')
  const updatedByUser = alias(user as any, 'updatedByUser')
  const conditions = [eq(tables.mainAwards.teamId, teamId)]
  const whereExpr = and(...conditions)

  let listQuery = (db as any)
    .select({
      ...tables.mainAwards,
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
    .from(tables.mainAwards)
    .leftJoin(ownerUser, eq(tables.mainAwards.owner, ownerUser.id))
    .leftJoin(createdByUser, eq(tables.mainAwards.createdBy, createdByUser.id))
    .leftJoin(updatedByUser, eq(tables.mainAwards.updatedBy, updatedByUser.id))
    .where(whereExpr)
    .orderBy(desc(tables.mainAwards.createdAt))

  if (opts.limit != null) {
    listQuery = listQuery.limit(opts.limit).offset(opts.offset ?? 0)
  }

  const awards = await listQuery

  if (opts.limit != null) {
    const [countRow] = await (db as any)
      .select({ count: sql`count(*)` })
      .from(tables.mainAwards)
      .where(whereExpr)
    return { items: awards, total: Number(countRow?.count ?? 0) }
  }

  return awards
}

export async function getMainAwardsByIds(teamId: string, awardIds: string[]) {
  const db = useDB()

  const ownerUser = alias(user as any, 'ownerUser')
  const createdByUser = alias(user as any, 'createdByUser')
  const updatedByUser = alias(user as any, 'updatedByUser')

  const awards = await (db as any)
    .select({
      ...tables.mainAwards,
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
    .from(tables.mainAwards)
    .leftJoin(ownerUser, eq(tables.mainAwards.owner, ownerUser.id))
    .leftJoin(createdByUser, eq(tables.mainAwards.createdBy, createdByUser.id))
    .leftJoin(updatedByUser, eq(tables.mainAwards.updatedBy, updatedByUser.id))
    .where(
      and(
        eq(tables.mainAwards.teamId, teamId),
        inArray(tables.mainAwards.id, awardIds)
      )
    )
    .orderBy(desc(tables.mainAwards.createdAt))

  return awards
}

export async function createMainAward(data: NewMainAward) {
  const db = useDB()

  const [award] = await (db as any)
    .insert(tables.mainAwards)
    .values(data)
    .returning()

  return award
}

export async function updateMainAward(
  recordId: string,
  teamId: string,
  userId: string,
  updates: Partial<MainAward>,
  options?: { role?: string }
) {
  const db = useDB()
  const isAdmin = options?.role === 'admin' || options?.role === 'owner'

  const conditions = [
    eq(tables.mainAwards.id, recordId),
    eq(tables.mainAwards.teamId, teamId),
  ]
  if (!isAdmin) {
    conditions.push(eq(tables.mainAwards.owner, userId))
  }

  const [award] = await (db as any)
    .update(tables.mainAwards)
    .set({
      ...updates,
      updatedBy: userId
    })
    .where(and(...conditions))
    .returning()

  if (!award) {
    throw createError({
      status: 404,
      statusText: 'MainAward not found or unauthorized'
    })
  }

  return award
}

export async function deleteMainAward(
  recordId: string,
  teamId: string,
  userId: string,
  options?: { role?: string }
) {
  const db = useDB()
  const isAdmin = options?.role === 'admin' || options?.role === 'owner'

  const conditions = [
    eq(tables.mainAwards.id, recordId),
    eq(tables.mainAwards.teamId, teamId),
  ]
  if (!isAdmin) {
    conditions.push(eq(tables.mainAwards.owner, userId))
  }

  const [deleted] = await (db as any)
    .delete(tables.mainAwards)
    .where(and(...conditions))
    .returning()

  if (!deleted) {
    throw createError({
      status: 404,
      statusText: 'MainAward not found or unauthorized'
    })
  }

  return { success: true }
}