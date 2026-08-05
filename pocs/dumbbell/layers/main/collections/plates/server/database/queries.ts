// Generated with JSON field post-processing support (v2025-01-11)
import { eq, and, desc, inArray, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/sqlite-core'
import * as tables from './schema'
import type { MainPlate, NewMainPlate } from '../../types'
import { user } from '~~/server/db/schema'

// Overload order matters: the paginated signature (required `limit`) must come
// first so non-paginated calls fall through to the array overload.
export async function getAllMainPlates(teamId: string, opts: { limit: number; offset?: number }): Promise<{ items: any[]; total: number }>
export async function getAllMainPlates(teamId: string, opts?: {}): Promise<any[]>
export async function getAllMainPlates(teamId: string, opts: { limit?: number; offset?: number } = {}) {
  const db = useDB()

  const ownerUser = alias(user as any, 'ownerUser')
  const createdByUser = alias(user as any, 'createdByUser')
  const updatedByUser = alias(user as any, 'updatedByUser')
  const conditions = [eq(tables.mainPlates.teamId, teamId)]
  const whereExpr = and(...conditions)

  let listQuery = (db as any)
    .select({
      ...tables.mainPlates,
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
    .from(tables.mainPlates)
    .leftJoin(ownerUser, eq(tables.mainPlates.owner, ownerUser.id))
    .leftJoin(createdByUser, eq(tables.mainPlates.createdBy, createdByUser.id))
    .leftJoin(updatedByUser, eq(tables.mainPlates.updatedBy, updatedByUser.id))
    .where(whereExpr)
    .orderBy(desc(tables.mainPlates.createdAt))

  if (opts.limit != null) {
    listQuery = listQuery.limit(opts.limit).offset(opts.offset ?? 0)
  }

  const plates = await listQuery

  if (opts.limit != null) {
    const [countRow] = await (db as any)
      .select({ count: sql`count(*)` })
      .from(tables.mainPlates)
      .where(whereExpr)
    return { items: plates, total: Number(countRow?.count ?? 0) }
  }

  return plates
}

export async function getMainPlatesByIds(teamId: string, plateIds: string[]) {
  const db = useDB()

  const ownerUser = alias(user as any, 'ownerUser')
  const createdByUser = alias(user as any, 'createdByUser')
  const updatedByUser = alias(user as any, 'updatedByUser')

  const plates = await (db as any)
    .select({
      ...tables.mainPlates,
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
    .from(tables.mainPlates)
    .leftJoin(ownerUser, eq(tables.mainPlates.owner, ownerUser.id))
    .leftJoin(createdByUser, eq(tables.mainPlates.createdBy, createdByUser.id))
    .leftJoin(updatedByUser, eq(tables.mainPlates.updatedBy, updatedByUser.id))
    .where(
      and(
        eq(tables.mainPlates.teamId, teamId),
        inArray(tables.mainPlates.id, plateIds)
      )
    )
    .orderBy(desc(tables.mainPlates.createdAt))

  return plates
}

export async function createMainPlate(data: NewMainPlate) {
  const db = useDB()

  const [plate] = await (db as any)
    .insert(tables.mainPlates)
    .values(data)
    .returning()

  return plate
}

export async function updateMainPlate(
  recordId: string,
  teamId: string,
  userId: string,
  updates: Partial<MainPlate>,
  options?: { role?: string }
) {
  const db = useDB()
  const isAdmin = options?.role === 'admin' || options?.role === 'owner'

  const conditions = [
    eq(tables.mainPlates.id, recordId),
    eq(tables.mainPlates.teamId, teamId),
  ]
  if (!isAdmin) {
    conditions.push(eq(tables.mainPlates.owner, userId))
  }

  const [plate] = await (db as any)
    .update(tables.mainPlates)
    .set({
      ...updates,
      updatedBy: userId
    })
    .where(and(...conditions))
    .returning()

  if (!plate) {
    throw createError({
      status: 404,
      statusText: 'MainPlate not found or unauthorized'
    })
  }

  return plate
}

export async function deleteMainPlate(
  recordId: string,
  teamId: string,
  userId: string,
  options?: { role?: string }
) {
  const db = useDB()
  const isAdmin = options?.role === 'admin' || options?.role === 'owner'

  const conditions = [
    eq(tables.mainPlates.id, recordId),
    eq(tables.mainPlates.teamId, teamId),
  ]
  if (!isAdmin) {
    conditions.push(eq(tables.mainPlates.owner, userId))
  }

  const [deleted] = await (db as any)
    .delete(tables.mainPlates)
    .where(and(...conditions))
    .returning()

  if (!deleted) {
    throw createError({
      status: 404,
      statusText: 'MainPlate not found or unauthorized'
    })
  }

  return { success: true }
}