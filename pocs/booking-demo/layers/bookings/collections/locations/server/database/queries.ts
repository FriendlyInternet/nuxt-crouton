// Generated with JSON field post-processing support (v2025-01-11)
import { eq, and, desc, inArray, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/sqlite-core'
import * as tables from './schema'
import type { BookingsLocation, NewBookingsLocation } from '../../types'
import { user } from '~~/server/db/schema'

// Overload order matters: the paginated signature (required `limit`) must come
// first so non-paginated calls fall through to the array overload.
export async function getAllBookingsLocations(teamId: string, opts: { limit: number; offset?: number }): Promise<{ items: any[]; total: number }>
export async function getAllBookingsLocations(teamId: string, opts?: {}): Promise<any[]>
export async function getAllBookingsLocations(teamId: string, opts: { limit?: number; offset?: number } = {}) {
  const db = useDB()

  const ownerUser = alias(user as any, 'ownerUser')
  const createdByUser = alias(user as any, 'createdByUser')
  const updatedByUser = alias(user as any, 'updatedByUser')
  const conditions = [eq(tables.bookingsLocations.teamId, teamId)]
  const whereExpr = and(...conditions)

  let listQuery = (db as any)
    .select({
      ...tables.bookingsLocations,
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
    .from(tables.bookingsLocations)
    .leftJoin(ownerUser, eq(tables.bookingsLocations.owner, ownerUser.id))
    .leftJoin(createdByUser, eq(tables.bookingsLocations.createdBy, createdByUser.id))
    .leftJoin(updatedByUser, eq(tables.bookingsLocations.updatedBy, updatedByUser.id))
    .where(whereExpr)
    .orderBy(desc(tables.bookingsLocations.createdAt))

  if (opts.limit != null) {
    listQuery = listQuery.limit(opts.limit).offset(opts.offset ?? 0)
  }

  const locations = await listQuery

  // Post-query processing for JSON fields (repeater/json types)
  locations.forEach((item: any) => {
      // Parse slots from JSON string
      if (typeof item.slots === 'string') {
        try {
          item.slots = JSON.parse(item.slots)
        } catch (e) {
          console.error('Error parsing slots:', e)
          item.slots = []
        }
      }
      if (item.slots === null || item.slots === undefined) {
        item.slots = []
      }
      // Parse slotSchedule from JSON string
      if (typeof item.slotSchedule === 'string') {
        try {
          item.slotSchedule = JSON.parse(item.slotSchedule)
        } catch (e) {
          console.error('Error parsing slotSchedule:', e)
          item.slotSchedule = null
        }
      }
      if (item.slotSchedule === null || item.slotSchedule === undefined) {
        item.slotSchedule = null
      }
      // Parse blockedDates from JSON string
      if (typeof item.blockedDates === 'string') {
        try {
          item.blockedDates = JSON.parse(item.blockedDates)
        } catch (e) {
          console.error('Error parsing blockedDates:', e)
          item.blockedDates = []
        }
      }
      if (item.blockedDates === null || item.blockedDates === undefined) {
        item.blockedDates = []
      }
  })

  if (opts.limit != null) {
    const [countRow] = await (db as any)
      .select({ count: sql`count(*)` })
      .from(tables.bookingsLocations)
      .where(whereExpr)
    return { items: locations, total: Number(countRow?.count ?? 0) }
  }

  return locations
}

export async function getBookingsLocationsByIds(teamId: string, locationIds: string[]) {
  const db = useDB()

  const ownerUser = alias(user as any, 'ownerUser')
  const createdByUser = alias(user as any, 'createdByUser')
  const updatedByUser = alias(user as any, 'updatedByUser')

  const locations = await (db as any)
    .select({
      ...tables.bookingsLocations,
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
    .from(tables.bookingsLocations)
    .leftJoin(ownerUser, eq(tables.bookingsLocations.owner, ownerUser.id))
    .leftJoin(createdByUser, eq(tables.bookingsLocations.createdBy, createdByUser.id))
    .leftJoin(updatedByUser, eq(tables.bookingsLocations.updatedBy, updatedByUser.id))
    .where(
      and(
        eq(tables.bookingsLocations.teamId, teamId),
        inArray(tables.bookingsLocations.id, locationIds)
      )
    )
    .orderBy(desc(tables.bookingsLocations.createdAt))

  // Post-query processing for JSON fields (repeater/json types)
  locations.forEach((item: any) => {
      // Parse slots from JSON string
      if (typeof item.slots === 'string') {
        try {
          item.slots = JSON.parse(item.slots)
        } catch (e) {
          console.error('Error parsing slots:', e)
          item.slots = []
        }
      }
      if (item.slots === null || item.slots === undefined) {
        item.slots = []
      }
      // Parse slotSchedule from JSON string
      if (typeof item.slotSchedule === 'string') {
        try {
          item.slotSchedule = JSON.parse(item.slotSchedule)
        } catch (e) {
          console.error('Error parsing slotSchedule:', e)
          item.slotSchedule = null
        }
      }
      if (item.slotSchedule === null || item.slotSchedule === undefined) {
        item.slotSchedule = null
      }
      // Parse blockedDates from JSON string
      if (typeof item.blockedDates === 'string') {
        try {
          item.blockedDates = JSON.parse(item.blockedDates)
        } catch (e) {
          console.error('Error parsing blockedDates:', e)
          item.blockedDates = []
        }
      }
      if (item.blockedDates === null || item.blockedDates === undefined) {
        item.blockedDates = []
      }
  })

  return locations
}

export async function createBookingsLocation(data: NewBookingsLocation) {
  const db = useDB()

  const [location] = await (db as any)
    .insert(tables.bookingsLocations)
    .values(data)
    .returning()

  return location
}

export async function updateBookingsLocation(
  recordId: string,
  teamId: string,
  userId: string,
  updates: Partial<BookingsLocation>,
  options?: { role?: string }
) {
  const db = useDB()
  const isAdmin = options?.role === 'admin' || options?.role === 'owner'

  const conditions = [
    eq(tables.bookingsLocations.id, recordId),
    eq(tables.bookingsLocations.teamId, teamId),
  ]
  if (!isAdmin) {
    conditions.push(eq(tables.bookingsLocations.owner, userId))
  }

  const [location] = await (db as any)
    .update(tables.bookingsLocations)
    .set({
      ...updates,
      updatedBy: userId
    })
    .where(and(...conditions))
    .returning()

  if (!location) {
    throw createError({
      status: 404,
      statusText: 'BookingsLocation not found or unauthorized'
    })
  }

  return location
}

export async function deleteBookingsLocation(
  recordId: string,
  teamId: string,
  userId: string,
  options?: { role?: string }
) {
  const db = useDB()
  const isAdmin = options?.role === 'admin' || options?.role === 'owner'

  const conditions = [
    eq(tables.bookingsLocations.id, recordId),
    eq(tables.bookingsLocations.teamId, teamId),
  ]
  if (!isAdmin) {
    conditions.push(eq(tables.bookingsLocations.owner, userId))
  }

  const [deleted] = await (db as any)
    .delete(tables.bookingsLocations)
    .where(and(...conditions))
    .returning()

  if (!deleted) {
    throw createError({
      status: 404,
      statusText: 'BookingsLocation not found or unauthorized'
    })
  }

  return { success: true }
}