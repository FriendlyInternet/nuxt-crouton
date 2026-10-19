// Generated with JSON field post-processing support (v2025-01-11)
import { eq, and, desc, inArray } from 'drizzle-orm'
import { alias } from 'drizzle-orm/sqlite-core'
import * as tables from './schema'
import type { BookingsEmaillog, NewBookingsEmaillog } from '../../types'
import * as bookingsSchema from '../../../bookings/server/database/schema'
import * as emailtemplatesSchema from '../../../emailtemplates/server/database/schema'
import { user } from '~~/server/db/schema'

export async function getAllBookingsEmaillogs(teamId: string) {
  const db = useDB()

  const ownerUser = alias(user as any, 'ownerUser')
  const createdByUser = alias(user as any, 'createdByUser')
  const updatedByUser = alias(user as any, 'updatedByUser')

  const emaillogs = await (db as any)
    .select({
      ...tables.bookingsEmaillogs,
      bookingIdData: bookingsSchema.bookingsBookings,
      templateIdData: emailtemplatesSchema.bookingsEmailtemplates,
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
    .from(tables.bookingsEmaillogs)
    .leftJoin(bookingsSchema.bookingsBookings, eq(tables.bookingsEmaillogs.bookingId, bookingsSchema.bookingsBookings.id))
    .leftJoin(emailtemplatesSchema.bookingsEmailtemplates, eq(tables.bookingsEmaillogs.templateId, emailtemplatesSchema.bookingsEmailtemplates.id))
    .leftJoin(ownerUser, eq(tables.bookingsEmaillogs.owner, ownerUser.id))
    .leftJoin(createdByUser, eq(tables.bookingsEmaillogs.createdBy, createdByUser.id))
    .leftJoin(updatedByUser, eq(tables.bookingsEmaillogs.updatedBy, updatedByUser.id))
    .where(eq(tables.bookingsEmaillogs.teamId, teamId))
    .orderBy(desc(tables.bookingsEmaillogs.createdAt))

  return emaillogs
}

export async function getBookingsEmaillogsByIds(teamId: string, emaillogIds: string[]) {
  const db = useDB()

  const ownerUser = alias(user as any, 'ownerUser')
  const createdByUser = alias(user as any, 'createdByUser')
  const updatedByUser = alias(user as any, 'updatedByUser')

  const emaillogs = await (db as any)
    .select({
      ...tables.bookingsEmaillogs,
      bookingIdData: bookingsSchema.bookingsBookings,
      templateIdData: emailtemplatesSchema.bookingsEmailtemplates,
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
    .from(tables.bookingsEmaillogs)
    .leftJoin(bookingsSchema.bookingsBookings, eq(tables.bookingsEmaillogs.bookingId, bookingsSchema.bookingsBookings.id))
    .leftJoin(emailtemplatesSchema.bookingsEmailtemplates, eq(tables.bookingsEmaillogs.templateId, emailtemplatesSchema.bookingsEmailtemplates.id))
    .leftJoin(ownerUser, eq(tables.bookingsEmaillogs.owner, ownerUser.id))
    .leftJoin(createdByUser, eq(tables.bookingsEmaillogs.createdBy, createdByUser.id))
    .leftJoin(updatedByUser, eq(tables.bookingsEmaillogs.updatedBy, updatedByUser.id))
    .where(
      and(
        eq(tables.bookingsEmaillogs.teamId, teamId),
        inArray(tables.bookingsEmaillogs.id, emaillogIds)
      )
    )
    .orderBy(desc(tables.bookingsEmaillogs.createdAt))

  return emaillogs
}

export async function createBookingsEmaillog(data: NewBookingsEmaillog) {
  const db = useDB()

  const [emaillog] = await (db as any)
    .insert(tables.bookingsEmaillogs)
    .values(data)
    .returning()

  return emaillog
}

export async function updateBookingsEmaillog(
  recordId: string,
  teamId: string,
  userId: string,
  updates: Partial<BookingsEmaillog>,
  options?: { role?: string }
) {
  const db = useDB()
  const isAdmin = options?.role === 'admin' || options?.role === 'owner'

  const conditions = [
    eq(tables.bookingsEmaillogs.id, recordId),
    eq(tables.bookingsEmaillogs.teamId, teamId),
  ]
  if (!isAdmin) {
    conditions.push(eq(tables.bookingsEmaillogs.owner, userId))
  }

  const [emaillog] = await (db as any)
    .update(tables.bookingsEmaillogs)
    .set({
      ...updates,
      updatedBy: userId
    })
    .where(and(...conditions))
    .returning()

  if (!emaillog) {
    throw createError({
      status: 404,
      statusText: 'BookingsEmaillog not found or unauthorized'
    })
  }

  return emaillog
}

export async function deleteBookingsEmaillog(
  recordId: string,
  teamId: string,
  userId: string,
  options?: { role?: string }
) {
  const db = useDB()
  const isAdmin = options?.role === 'admin' || options?.role === 'owner'

  const conditions = [
    eq(tables.bookingsEmaillogs.id, recordId),
    eq(tables.bookingsEmaillogs.teamId, teamId),
  ]
  if (!isAdmin) {
    conditions.push(eq(tables.bookingsEmaillogs.owner, userId))
  }

  const [deleted] = await (db as any)
    .delete(tables.bookingsEmaillogs)
    .where(and(...conditions))
    .returning()

  if (!deleted) {
    throw createError({
      status: 404,
      statusText: 'BookingsEmaillog not found or unauthorized'
    })
  }

  return { success: true }
}