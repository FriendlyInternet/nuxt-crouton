// Generated with JSON field post-processing support (v2025-01-11)
import { eq, and, desc, inArray, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/sqlite-core'
import * as tables from './schema'
import type { BookingsBooking, NewBookingsBooking } from '../../types'
import * as locationsSchema from '../../../locations/server/database/schema'
import { user } from '~~/server/db/schema'

// Overload order matters: the paginated signature (required `limit`) must come
// first so non-paginated calls fall through to the array overload.
export async function getAllBookingsBookings(teamId: string, opts: { location?: string; limit: number; offset?: number }): Promise<{ items: any[]; total: number }>
export async function getAllBookingsBookings(teamId: string, opts?: { location?: string }): Promise<any[]>
export async function getAllBookingsBookings(teamId: string, opts: { location?: string; limit?: number; offset?: number } = {}) {
  const db = useDB()

  const ownerUser = alias(user as any, 'ownerUser')
  const createdByUser = alias(user as any, 'createdByUser')
  const updatedByUser = alias(user as any, 'updatedByUser')
  const conditions = [eq(tables.bookingsBookings.teamId, teamId)]
  if (opts.location) conditions.push(eq(tables.bookingsBookings.location, opts.location))
  const whereExpr = and(...conditions)

  let listQuery = (db as any)
    .select({
      ...tables.bookingsBookings,
      locationData: locationsSchema.bookingsLocations,
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
    .from(tables.bookingsBookings)
    .leftJoin(locationsSchema.bookingsLocations, eq(tables.bookingsBookings.location, locationsSchema.bookingsLocations.id))
    .leftJoin(ownerUser, eq(tables.bookingsBookings.owner, ownerUser.id))
    .leftJoin(createdByUser, eq(tables.bookingsBookings.createdBy, createdByUser.id))
    .leftJoin(updatedByUser, eq(tables.bookingsBookings.updatedBy, updatedByUser.id))
    .where(whereExpr)
    .orderBy(desc(tables.bookingsBookings.createdAt))

  if (opts.limit != null) {
    listQuery = listQuery.limit(opts.limit).offset(opts.offset ?? 0)
  }

  const bookings = await listQuery

  if (opts.limit != null) {
    const [countRow] = await (db as any)
      .select({ count: sql`count(*)` })
      .from(tables.bookingsBookings)
      .where(whereExpr)
    return { items: bookings, total: Number(countRow?.count ?? 0) }
  }

  return bookings
}

export async function getBookingsBookingsByIds(teamId: string, bookingIds: string[]) {
  const db = useDB()

  const ownerUser = alias(user as any, 'ownerUser')
  const createdByUser = alias(user as any, 'createdByUser')
  const updatedByUser = alias(user as any, 'updatedByUser')

  const bookings = await (db as any)
    .select({
      ...tables.bookingsBookings,
      locationData: locationsSchema.bookingsLocations,
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
    .from(tables.bookingsBookings)
    .leftJoin(locationsSchema.bookingsLocations, eq(tables.bookingsBookings.location, locationsSchema.bookingsLocations.id))
    .leftJoin(ownerUser, eq(tables.bookingsBookings.owner, ownerUser.id))
    .leftJoin(createdByUser, eq(tables.bookingsBookings.createdBy, createdByUser.id))
    .leftJoin(updatedByUser, eq(tables.bookingsBookings.updatedBy, updatedByUser.id))
    .where(
      and(
        eq(tables.bookingsBookings.teamId, teamId),
        inArray(tables.bookingsBookings.id, bookingIds)
      )
    )
    .orderBy(desc(tables.bookingsBookings.createdAt))

  return bookings
}

export async function createBookingsBooking(data: NewBookingsBooking) {
  const db = useDB()

  const [booking] = await (db as any)
    .insert(tables.bookingsBookings)
    .values(data)
    .returning()

  return booking
}

export async function updateBookingsBooking(
  recordId: string,
  teamId: string,
  userId: string,
  updates: Partial<BookingsBooking>,
  options?: { role?: string }
) {
  const db = useDB()
  const isAdmin = options?.role === 'admin' || options?.role === 'owner'

  const conditions = [
    eq(tables.bookingsBookings.id, recordId),
    eq(tables.bookingsBookings.teamId, teamId),
  ]
  if (!isAdmin) {
    conditions.push(eq(tables.bookingsBookings.owner, userId))
  }

  const [booking] = await (db as any)
    .update(tables.bookingsBookings)
    .set({
      ...updates,
      updatedBy: userId
    })
    .where(and(...conditions))
    .returning()

  if (!booking) {
    throw createError({
      status: 404,
      statusText: 'BookingsBooking not found or unauthorized'
    })
  }

  return booking
}

export async function deleteBookingsBooking(
  recordId: string,
  teamId: string,
  userId: string,
  options?: { role?: string }
) {
  const db = useDB()
  const isAdmin = options?.role === 'admin' || options?.role === 'owner'

  const conditions = [
    eq(tables.bookingsBookings.id, recordId),
    eq(tables.bookingsBookings.teamId, teamId),
  ]
  if (!isAdmin) {
    conditions.push(eq(tables.bookingsBookings.owner, userId))
  }

  const [deleted] = await (db as any)
    .delete(tables.bookingsBookings)
    .where(and(...conditions))
    .returning()

  if (!deleted) {
    throw createError({
      status: 404,
      statusText: 'BookingsBooking not found or unauthorized'
    })
  }

  return { success: true }
}