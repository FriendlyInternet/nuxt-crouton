// Generated with JSON field post-processing support (v2025-01-11)
import { eq, and, desc, inArray, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/sqlite-core'
import * as tables from './schema'
import type { BuilderBooking, NewBuilderBooking } from '../../types'
import * as artistsSchema from '../../../artists/server/database/schema'
import { user } from '~~/server/db/schema'

// Overload order matters: the paginated signature (required `limit`) must come
// first so non-paginated calls fall through to the array overload.
export async function getAllBuilderBookings(teamId: string, opts: { artist?: string; limit: number; offset?: number }): Promise<{ items: any[]; total: number }>
export async function getAllBuilderBookings(teamId: string, opts?: { artist?: string }): Promise<any[]>
export async function getAllBuilderBookings(teamId: string, opts: { artist?: string; limit?: number; offset?: number } = {}) {
  const db = useDB()

  const ownerUser = alias(user as any, 'ownerUser')
  const createdByUser = alias(user as any, 'createdByUser')
  const updatedByUser = alias(user as any, 'updatedByUser')
  const conditions = [eq(tables.builderBookings.teamId, teamId)]
  if (opts.artist) conditions.push(eq(tables.builderBookings.artist, opts.artist))
  const whereExpr = and(...conditions)

  let listQuery = (db as any)
    .select({
      ...tables.builderBookings,
      artistData: artistsSchema.builderArtists,
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
    .from(tables.builderBookings)
    .leftJoin(artistsSchema.builderArtists, eq(tables.builderBookings.artist, artistsSchema.builderArtists.id))
    .leftJoin(ownerUser, eq(tables.builderBookings.owner, ownerUser.id))
    .leftJoin(createdByUser, eq(tables.builderBookings.createdBy, createdByUser.id))
    .leftJoin(updatedByUser, eq(tables.builderBookings.updatedBy, updatedByUser.id))
    .where(whereExpr)
    .orderBy(desc(tables.builderBookings.createdAt))

  if (opts.limit != null) {
    listQuery = listQuery.limit(opts.limit).offset(opts.offset ?? 0)
  }

  const bookings = await listQuery

  if (opts.limit != null) {
    const [countRow] = await (db as any)
      .select({ count: sql`count(*)` })
      .from(tables.builderBookings)
      .where(whereExpr)
    return { items: bookings, total: Number(countRow?.count ?? 0) }
  }

  return bookings
}

export async function getBuilderBookingsByIds(teamId: string, bookingIds: string[]) {
  const db = useDB()

  const ownerUser = alias(user as any, 'ownerUser')
  const createdByUser = alias(user as any, 'createdByUser')
  const updatedByUser = alias(user as any, 'updatedByUser')

  const bookings = await (db as any)
    .select({
      ...tables.builderBookings,
      artistData: artistsSchema.builderArtists,
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
    .from(tables.builderBookings)
    .leftJoin(artistsSchema.builderArtists, eq(tables.builderBookings.artist, artistsSchema.builderArtists.id))
    .leftJoin(ownerUser, eq(tables.builderBookings.owner, ownerUser.id))
    .leftJoin(createdByUser, eq(tables.builderBookings.createdBy, createdByUser.id))
    .leftJoin(updatedByUser, eq(tables.builderBookings.updatedBy, updatedByUser.id))
    .where(
      and(
        eq(tables.builderBookings.teamId, teamId),
        inArray(tables.builderBookings.id, bookingIds)
      )
    )
    .orderBy(desc(tables.builderBookings.createdAt))

  return bookings
}

export async function createBuilderBooking(data: NewBuilderBooking) {
  const db = useDB()

  const [booking] = await (db as any)
    .insert(tables.builderBookings)
    .values(data)
    .returning()

  return booking
}

export async function updateBuilderBooking(
  recordId: string,
  teamId: string,
  userId: string,
  updates: Partial<BuilderBooking>,
  options?: { role?: string }
) {
  const db = useDB()
  const isAdmin = options?.role === 'admin' || options?.role === 'owner'

  const conditions = [
    eq(tables.builderBookings.id, recordId),
    eq(tables.builderBookings.teamId, teamId),
  ]
  if (!isAdmin) {
    conditions.push(eq(tables.builderBookings.owner, userId))
  }

  const [booking] = await (db as any)
    .update(tables.builderBookings)
    .set({
      ...updates,
      updatedBy: userId
    })
    .where(and(...conditions))
    .returning()

  if (!booking) {
    throw createError({
      status: 404,
      statusText: 'BuilderBooking not found or unauthorized'
    })
  }

  return booking
}

export async function deleteBuilderBooking(
  recordId: string,
  teamId: string,
  userId: string,
  options?: { role?: string }
) {
  const db = useDB()
  const isAdmin = options?.role === 'admin' || options?.role === 'owner'

  const conditions = [
    eq(tables.builderBookings.id, recordId),
    eq(tables.builderBookings.teamId, teamId),
  ]
  if (!isAdmin) {
    conditions.push(eq(tables.builderBookings.owner, userId))
  }

  const [deleted] = await (db as any)
    .delete(tables.builderBookings)
    .where(and(...conditions))
    .returning()

  if (!deleted) {
    throw createError({
      status: 404,
      statusText: 'BuilderBooking not found or unauthorized'
    })
  }

  return { success: true }
}