// Generated with JSON field post-processing support (v2025-01-11)
import { eq, and, desc, inArray, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/sqlite-core'
import * as tables from './schema'
import type { CrankletLever, NewCrankletLever } from '../../types'
import { user } from '~~/server/db/schema'

// Overload order matters: the paginated signature (required `limit`) must come
// first so non-paginated calls fall through to the array overload.
export async function getAllCrankletLevers(teamId: string, opts: { limit: number; offset?: number }): Promise<{ items: any[]; total: number }>
export async function getAllCrankletLevers(teamId: string, opts?: {}): Promise<any[]>
export async function getAllCrankletLevers(teamId: string, opts: { limit?: number; offset?: number } = {}) {
  const db = useDB()

  const ownerUser = alias(user as any, 'ownerUser')
  const createdByUser = alias(user as any, 'createdByUser')
  const updatedByUser = alias(user as any, 'updatedByUser')
  const conditions = [eq(tables.crankletLevers.teamId, teamId)]
  const whereExpr = and(...conditions)

  let listQuery = (db as any)
    .select({
      ...tables.crankletLevers,
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
    .from(tables.crankletLevers)
    .leftJoin(ownerUser, eq(tables.crankletLevers.owner, ownerUser.id))
    .leftJoin(createdByUser, eq(tables.crankletLevers.createdBy, createdByUser.id))
    .leftJoin(updatedByUser, eq(tables.crankletLevers.updatedBy, updatedByUser.id))
    .where(whereExpr)
    .orderBy(desc(tables.crankletLevers.createdAt))

  if (opts.limit != null) {
    listQuery = listQuery.limit(opts.limit).offset(opts.offset ?? 0)
  }

  const levers = await listQuery

  if (opts.limit != null) {
    const [countRow] = await (db as any)
      .select({ count: sql`count(*)` })
      .from(tables.crankletLevers)
      .where(whereExpr)
    return { items: levers, total: Number(countRow?.count ?? 0) }
  }

  return levers
}

export async function getCrankletLeversByIds(teamId: string, leverIds: string[]) {
  const db = useDB()

  const ownerUser = alias(user as any, 'ownerUser')
  const createdByUser = alias(user as any, 'createdByUser')
  const updatedByUser = alias(user as any, 'updatedByUser')

  const levers = await (db as any)
    .select({
      ...tables.crankletLevers,
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
    .from(tables.crankletLevers)
    .leftJoin(ownerUser, eq(tables.crankletLevers.owner, ownerUser.id))
    .leftJoin(createdByUser, eq(tables.crankletLevers.createdBy, createdByUser.id))
    .leftJoin(updatedByUser, eq(tables.crankletLevers.updatedBy, updatedByUser.id))
    .where(
      and(
        eq(tables.crankletLevers.teamId, teamId),
        inArray(tables.crankletLevers.id, leverIds)
      )
    )
    .orderBy(desc(tables.crankletLevers.createdAt))

  return levers
}

export async function createCrankletLever(data: NewCrankletLever) {
  const db = useDB()

  const [lever] = await (db as any)
    .insert(tables.crankletLevers)
    .values(data)
    .returning()

  return lever
}

export async function updateCrankletLever(
  recordId: string,
  teamId: string,
  userId: string,
  updates: Partial<CrankletLever>,
  options?: { role?: string }
) {
  const db = useDB()
  const isAdmin = options?.role === 'admin' || options?.role === 'owner'

  const conditions = [
    eq(tables.crankletLevers.id, recordId),
    eq(tables.crankletLevers.teamId, teamId),
  ]
  if (!isAdmin) {
    conditions.push(eq(tables.crankletLevers.owner, userId))
  }

  const [lever] = await (db as any)
    .update(tables.crankletLevers)
    .set({
      ...updates,
      updatedBy: userId
    })
    .where(and(...conditions))
    .returning()

  if (!lever) {
    throw createError({
      status: 404,
      statusText: 'CrankletLever not found or unauthorized'
    })
  }

  return lever
}

export async function deleteCrankletLever(
  recordId: string,
  teamId: string,
  userId: string,
  options?: { role?: string }
) {
  const db = useDB()
  const isAdmin = options?.role === 'admin' || options?.role === 'owner'

  const conditions = [
    eq(tables.crankletLevers.id, recordId),
    eq(tables.crankletLevers.teamId, teamId),
  ]
  if (!isAdmin) {
    conditions.push(eq(tables.crankletLevers.owner, userId))
  }

  const [deleted] = await (db as any)
    .delete(tables.crankletLevers)
    .where(and(...conditions))
    .returning()

  if (!deleted) {
    throw createError({
      status: 404,
      statusText: 'CrankletLever not found or unauthorized'
    })
  }

  return { success: true }
}