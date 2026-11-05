// Generated with JSON field post-processing support (v2025-01-11)
import { eq, and, desc, inArray, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/sqlite-core'
import * as tables from './schema'
import type { CrateTrack, NewCrateTrack } from '../../types'
import { user } from '~~/server/db/schema'

// Overload order matters: the paginated signature (required `limit`) must come
// first so non-paginated calls fall through to the array overload.
export async function getAllCrateTracks(teamId: string, opts: { owner?: string; createdBy?: string; updatedBy?: string; limit: number; offset?: number }): Promise<{ items: any[]; total: number }>
export async function getAllCrateTracks(teamId: string, opts?: { owner?: string; createdBy?: string; updatedBy?: string }): Promise<any[]>
export async function getAllCrateTracks(teamId: string, opts: { owner?: string; createdBy?: string; updatedBy?: string; limit?: number; offset?: number } = {}) {
  const db = useDB()

  const ownerUser = alias(user as any, 'ownerUser')
  const createdByUser = alias(user as any, 'createdByUser')
  const updatedByUser = alias(user as any, 'updatedByUser')
  const conditions = [eq(tables.crateTracks.teamId, teamId)]
  if (opts.owner) conditions.push(eq(tables.crateTracks.owner, opts.owner))
  if (opts.createdBy) conditions.push(eq(tables.crateTracks.createdBy, opts.createdBy))
  if (opts.updatedBy) conditions.push(eq(tables.crateTracks.updatedBy, opts.updatedBy))
  const whereExpr = and(...conditions)

  let listQuery = (db as any)
    .select({
      ...tables.crateTracks,
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
    .from(tables.crateTracks)
    .leftJoin(ownerUser, eq(tables.crateTracks.owner, ownerUser.id))
    .leftJoin(createdByUser, eq(tables.crateTracks.createdBy, createdByUser.id))
    .leftJoin(updatedByUser, eq(tables.crateTracks.updatedBy, updatedByUser.id))
    .where(whereExpr)
    .orderBy(desc(tables.crateTracks.createdAt))

  if (opts.limit != null) {
    listQuery = listQuery.limit(opts.limit).offset(opts.offset ?? 0)
  }

  const tracks = await listQuery

  if (opts.limit != null) {
    const [countRow] = await (db as any)
      .select({ count: sql`count(*)` })
      .from(tables.crateTracks)
      .where(whereExpr)
    return { items: tracks, total: Number(countRow?.count ?? 0) }
  }

  return tracks
}

export async function getCrateTracksByIds(teamId: string, trackIds: string[]) {
  const db = useDB()

  const ownerUser = alias(user as any, 'ownerUser')
  const createdByUser = alias(user as any, 'createdByUser')
  const updatedByUser = alias(user as any, 'updatedByUser')

  const tracks = await (db as any)
    .select({
      ...tables.crateTracks,
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
    .from(tables.crateTracks)
    .leftJoin(ownerUser, eq(tables.crateTracks.owner, ownerUser.id))
    .leftJoin(createdByUser, eq(tables.crateTracks.createdBy, createdByUser.id))
    .leftJoin(updatedByUser, eq(tables.crateTracks.updatedBy, updatedByUser.id))
    .where(
      and(
        eq(tables.crateTracks.teamId, teamId),
        inArray(tables.crateTracks.id, trackIds)
      )
    )
    .orderBy(desc(tables.crateTracks.createdAt))

  return tracks
}

export async function createCrateTrack(data: NewCrateTrack) {
  const db = useDB()

  const [track] = await (db as any)
    .insert(tables.crateTracks)
    .values(data)
    .returning()

  return track
}

export async function updateCrateTrack(
  recordId: string,
  teamId: string,
  userId: string,
  updates: Partial<CrateTrack>,
  options?: { role?: string }
) {
  const db = useDB()
  const isAdmin = options?.role === 'admin' || options?.role === 'owner'

  const conditions = [
    eq(tables.crateTracks.id, recordId),
    eq(tables.crateTracks.teamId, teamId),
  ]
  if (!isAdmin) {
    conditions.push(eq(tables.crateTracks.owner, userId))
  }

  const [track] = await (db as any)
    .update(tables.crateTracks)
    .set({
      ...updates,
      updatedBy: userId
    })
    .where(and(...conditions))
    .returning()

  if (!track) {
    throw createError({
      status: 404,
      statusText: 'CrateTrack not found or unauthorized'
    })
  }

  return track
}

export async function deleteCrateTrack(
  recordId: string,
  teamId: string,
  userId: string,
  options?: { role?: string }
) {
  const db = useDB()
  const isAdmin = options?.role === 'admin' || options?.role === 'owner'

  const conditions = [
    eq(tables.crateTracks.id, recordId),
    eq(tables.crateTracks.teamId, teamId),
  ]
  if (!isAdmin) {
    conditions.push(eq(tables.crateTracks.owner, userId))
  }

  const [deleted] = await (db as any)
    .delete(tables.crateTracks)
    .where(and(...conditions))
    .returning()

  if (!deleted) {
    throw createError({
      status: 404,
      statusText: 'CrateTrack not found or unauthorized'
    })
  }

  return { success: true }
}