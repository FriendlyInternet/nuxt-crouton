// Generated with JSON field post-processing support (v2025-01-11)
import { eq, and, desc, inArray, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/sqlite-core'
import * as tables from './schema'
import type { BuilderArtist, NewBuilderArtist } from '../../types'
import { user } from '~~/server/db/schema'

// Overload order matters: the paginated signature (required `limit`) must come
// first so non-paginated calls fall through to the array overload.
export async function getAllBuilderArtists(teamId: string, opts: { limit: number; offset?: number }): Promise<{ items: any[]; total: number }>
export async function getAllBuilderArtists(teamId: string, opts?: {}): Promise<any[]>
export async function getAllBuilderArtists(teamId: string, opts: { limit?: number; offset?: number } = {}) {
  const db = useDB()

  const ownerUser = alias(user as any, 'ownerUser')
  const createdByUser = alias(user as any, 'createdByUser')
  const updatedByUser = alias(user as any, 'updatedByUser')
  const conditions = [eq(tables.builderArtists.teamId, teamId)]
  const whereExpr = and(...conditions)

  let listQuery = (db as any)
    .select({
      ...tables.builderArtists,
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
    .from(tables.builderArtists)
    .leftJoin(ownerUser, eq(tables.builderArtists.owner, ownerUser.id))
    .leftJoin(createdByUser, eq(tables.builderArtists.createdBy, createdByUser.id))
    .leftJoin(updatedByUser, eq(tables.builderArtists.updatedBy, updatedByUser.id))
    .where(whereExpr)
    .orderBy(desc(tables.builderArtists.createdAt))

  if (opts.limit != null) {
    listQuery = listQuery.limit(opts.limit).offset(opts.offset ?? 0)
  }

  const artists = await listQuery

  if (opts.limit != null) {
    const [countRow] = await (db as any)
      .select({ count: sql`count(*)` })
      .from(tables.builderArtists)
      .where(whereExpr)
    return { items: artists, total: Number(countRow?.count ?? 0) }
  }

  return artists
}

export async function getBuilderArtistsByIds(teamId: string, artistIds: string[]) {
  const db = useDB()

  const ownerUser = alias(user as any, 'ownerUser')
  const createdByUser = alias(user as any, 'createdByUser')
  const updatedByUser = alias(user as any, 'updatedByUser')

  const artists = await (db as any)
    .select({
      ...tables.builderArtists,
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
    .from(tables.builderArtists)
    .leftJoin(ownerUser, eq(tables.builderArtists.owner, ownerUser.id))
    .leftJoin(createdByUser, eq(tables.builderArtists.createdBy, createdByUser.id))
    .leftJoin(updatedByUser, eq(tables.builderArtists.updatedBy, updatedByUser.id))
    .where(
      and(
        eq(tables.builderArtists.teamId, teamId),
        inArray(tables.builderArtists.id, artistIds)
      )
    )
    .orderBy(desc(tables.builderArtists.createdAt))

  return artists
}

export async function createBuilderArtist(data: NewBuilderArtist) {
  const db = useDB()

  const [artist] = await (db as any)
    .insert(tables.builderArtists)
    .values(data)
    .returning()

  return artist
}

export async function updateBuilderArtist(
  recordId: string,
  teamId: string,
  userId: string,
  updates: Partial<BuilderArtist>,
  options?: { role?: string }
) {
  const db = useDB()
  const isAdmin = options?.role === 'admin' || options?.role === 'owner'

  const conditions = [
    eq(tables.builderArtists.id, recordId),
    eq(tables.builderArtists.teamId, teamId),
  ]
  if (!isAdmin) {
    conditions.push(eq(tables.builderArtists.owner, userId))
  }

  const [artist] = await (db as any)
    .update(tables.builderArtists)
    .set({
      ...updates,
      updatedBy: userId
    })
    .where(and(...conditions))
    .returning()

  if (!artist) {
    throw createError({
      status: 404,
      statusText: 'BuilderArtist not found or unauthorized'
    })
  }

  return artist
}

export async function deleteBuilderArtist(
  recordId: string,
  teamId: string,
  userId: string,
  options?: { role?: string }
) {
  const db = useDB()
  const isAdmin = options?.role === 'admin' || options?.role === 'owner'

  const conditions = [
    eq(tables.builderArtists.id, recordId),
    eq(tables.builderArtists.teamId, teamId),
  ]
  if (!isAdmin) {
    conditions.push(eq(tables.builderArtists.owner, userId))
  }

  const [deleted] = await (db as any)
    .delete(tables.builderArtists)
    .where(and(...conditions))
    .returning()

  if (!deleted) {
    throw createError({
      status: 404,
      statusText: 'BuilderArtist not found or unauthorized'
    })
  }

  return { success: true }
}