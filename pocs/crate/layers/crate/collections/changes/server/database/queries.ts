// Generated with JSON field post-processing support (v2025-01-11)
import { eq, and, desc, inArray, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/sqlite-core'
import * as tables from './schema'
import type { CrateChange, NewCrateChange } from '../../types'
import * as tracksSchema from '../../../tracks/server/database/schema'
import { user } from '~~/server/db/schema'

// Overload order matters: the paginated signature (required `limit`) must come
// first so non-paginated calls fall through to the array overload.
export async function getAllCrateChanges(teamId: string, opts: { trackId?: string; owner?: string; createdBy?: string; updatedBy?: string; limit: number; offset?: number }): Promise<{ items: any[]; total: number }>
export async function getAllCrateChanges(teamId: string, opts?: { trackId?: string; owner?: string; createdBy?: string; updatedBy?: string }): Promise<any[]>
export async function getAllCrateChanges(teamId: string, opts: { trackId?: string; owner?: string; createdBy?: string; updatedBy?: string; limit?: number; offset?: number } = {}) {
  const db = useDB()

  const ownerUser = alias(user as any, 'ownerUser')
  const createdByUser = alias(user as any, 'createdByUser')
  const updatedByUser = alias(user as any, 'updatedByUser')
  const conditions = [eq(tables.crateChanges.teamId, teamId)]
  if (opts.trackId) conditions.push(eq(tables.crateChanges.trackId, opts.trackId))
  if (opts.owner) conditions.push(eq(tables.crateChanges.owner, opts.owner))
  if (opts.createdBy) conditions.push(eq(tables.crateChanges.createdBy, opts.createdBy))
  if (opts.updatedBy) conditions.push(eq(tables.crateChanges.updatedBy, opts.updatedBy))
  const whereExpr = and(...conditions)

  let listQuery = (db as any)
    .select({
      ...tables.crateChanges,
      trackIdData: tracksSchema.crateTracks,
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
    .from(tables.crateChanges)
    .leftJoin(tracksSchema.crateTracks, eq(tables.crateChanges.trackId, tracksSchema.crateTracks.id))
    .leftJoin(ownerUser, eq(tables.crateChanges.owner, ownerUser.id))
    .leftJoin(createdByUser, eq(tables.crateChanges.createdBy, createdByUser.id))
    .leftJoin(updatedByUser, eq(tables.crateChanges.updatedBy, updatedByUser.id))
    .where(whereExpr)
    .orderBy(desc(tables.crateChanges.createdAt))

  if (opts.limit != null) {
    listQuery = listQuery.limit(opts.limit).offset(opts.offset ?? 0)
  }

  const changes = await listQuery

  if (opts.limit != null) {
    const [countRow] = await (db as any)
      .select({ count: sql`count(*)` })
      .from(tables.crateChanges)
      .where(whereExpr)
    return { items: changes, total: Number(countRow?.count ?? 0) }
  }

  return changes
}

export async function getCrateChangesByIds(teamId: string, changeIds: string[]) {
  const db = useDB()

  const ownerUser = alias(user as any, 'ownerUser')
  const createdByUser = alias(user as any, 'createdByUser')
  const updatedByUser = alias(user as any, 'updatedByUser')

  const changes = await (db as any)
    .select({
      ...tables.crateChanges,
      trackIdData: tracksSchema.crateTracks,
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
    .from(tables.crateChanges)
    .leftJoin(tracksSchema.crateTracks, eq(tables.crateChanges.trackId, tracksSchema.crateTracks.id))
    .leftJoin(ownerUser, eq(tables.crateChanges.owner, ownerUser.id))
    .leftJoin(createdByUser, eq(tables.crateChanges.createdBy, createdByUser.id))
    .leftJoin(updatedByUser, eq(tables.crateChanges.updatedBy, updatedByUser.id))
    .where(
      and(
        eq(tables.crateChanges.teamId, teamId),
        inArray(tables.crateChanges.id, changeIds)
      )
    )
    .orderBy(desc(tables.crateChanges.createdAt))

  return changes
}

export async function createCrateChange(data: NewCrateChange) {
  const db = useDB()

  const [change] = await (db as any)
    .insert(tables.crateChanges)
    .values(data)
    .returning()

  return change
}

export async function updateCrateChange(
  recordId: string,
  teamId: string,
  userId: string,
  updates: Partial<CrateChange>,
  options?: { role?: string }
) {
  const db = useDB()
  const isAdmin = options?.role === 'admin' || options?.role === 'owner'

  const conditions = [
    eq(tables.crateChanges.id, recordId),
    eq(tables.crateChanges.teamId, teamId),
  ]
  if (!isAdmin) {
    conditions.push(eq(tables.crateChanges.owner, userId))
  }

  const [change] = await (db as any)
    .update(tables.crateChanges)
    .set({
      ...updates,
      updatedBy: userId
    })
    .where(and(...conditions))
    .returning()

  if (!change) {
    throw createError({
      status: 404,
      statusText: 'CrateChange not found or unauthorized'
    })
  }

  return change
}

export async function deleteCrateChange(
  recordId: string,
  teamId: string,
  userId: string,
  options?: { role?: string }
) {
  const db = useDB()
  const isAdmin = options?.role === 'admin' || options?.role === 'owner'

  const conditions = [
    eq(tables.crateChanges.id, recordId),
    eq(tables.crateChanges.teamId, teamId),
  ]
  if (!isAdmin) {
    conditions.push(eq(tables.crateChanges.owner, userId))
  }

  const [deleted] = await (db as any)
    .delete(tables.crateChanges)
    .where(and(...conditions))
    .returning()

  if (!deleted) {
    throw createError({
      status: 404,
      statusText: 'CrateChange not found or unauthorized'
    })
  }

  return { success: true }
}