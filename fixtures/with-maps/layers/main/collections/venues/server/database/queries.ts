// Generated with JSON field post-processing support (v2025-01-11)
import { eq, and, desc, inArray, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/sqlite-core'
import * as tables from './schema'
import type { MainVenue, NewMainVenue } from '../../types'
import { user } from '~~/server/db/schema'

// Overload order matters: the paginated signature (required `limit`) must come
// first so non-paginated calls fall through to the array overload.
export async function getAllMainVenues(teamId: string, opts: { owner?: string; createdBy?: string; updatedBy?: string; limit: number; offset?: number }): Promise<{ items: any[]; total: number }>
export async function getAllMainVenues(teamId: string, opts?: { owner?: string; createdBy?: string; updatedBy?: string }): Promise<any[]>
export async function getAllMainVenues(teamId: string, opts: { owner?: string; createdBy?: string; updatedBy?: string; limit?: number; offset?: number } = {}) {
  const db = useDB()

  const ownerUser = alias(user as any, 'ownerUser')
  const createdByUser = alias(user as any, 'createdByUser')
  const updatedByUser = alias(user as any, 'updatedByUser')
  const conditions = [eq(tables.mainVenues.teamId, teamId)]
  if (opts.owner) conditions.push(eq(tables.mainVenues.owner, opts.owner))
  if (opts.createdBy) conditions.push(eq(tables.mainVenues.createdBy, opts.createdBy))
  if (opts.updatedBy) conditions.push(eq(tables.mainVenues.updatedBy, opts.updatedBy))
  const whereExpr = and(...conditions)

  let listQuery = (db as any)
    .select({
      ...tables.mainVenues,
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
    .from(tables.mainVenues)
    .leftJoin(ownerUser, eq(tables.mainVenues.owner, ownerUser.id))
    .leftJoin(createdByUser, eq(tables.mainVenues.createdBy, createdByUser.id))
    .leftJoin(updatedByUser, eq(tables.mainVenues.updatedBy, updatedByUser.id))
    .where(whereExpr)
    .orderBy(desc(tables.mainVenues.createdAt))

  if (opts.limit != null) {
    listQuery = listQuery.limit(opts.limit).offset(opts.offset ?? 0)
  }

  const venues = await listQuery

  if (opts.limit != null) {
    const [countRow] = await (db as any)
      .select({ count: sql`count(*)` })
      .from(tables.mainVenues)
      .where(whereExpr)
    return { items: venues, total: Number(countRow?.count ?? 0) }
  }

  return venues
}

export async function getMainVenuesByIds(teamId: string, venueIds: string[]) {
  const db = useDB()

  const ownerUser = alias(user as any, 'ownerUser')
  const createdByUser = alias(user as any, 'createdByUser')
  const updatedByUser = alias(user as any, 'updatedByUser')

  const venues = await (db as any)
    .select({
      ...tables.mainVenues,
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
    .from(tables.mainVenues)
    .leftJoin(ownerUser, eq(tables.mainVenues.owner, ownerUser.id))
    .leftJoin(createdByUser, eq(tables.mainVenues.createdBy, createdByUser.id))
    .leftJoin(updatedByUser, eq(tables.mainVenues.updatedBy, updatedByUser.id))
    .where(
      and(
        eq(tables.mainVenues.teamId, teamId),
        inArray(tables.mainVenues.id, venueIds)
      )
    )
    .orderBy(desc(tables.mainVenues.createdAt))

  return venues
}

export async function createMainVenue(data: NewMainVenue) {
  const db = useDB()

  const [venue] = await (db as any)
    .insert(tables.mainVenues)
    .values(data)
    .returning()

  return venue
}

export async function updateMainVenue(
  recordId: string,
  teamId: string,
  userId: string,
  updates: Partial<MainVenue>,
  options?: { role?: string }
) {
  const db = useDB()
  const isAdmin = options?.role === 'admin' || options?.role === 'owner'

  const conditions = [
    eq(tables.mainVenues.id, recordId),
    eq(tables.mainVenues.teamId, teamId),
  ]
  if (!isAdmin) {
    conditions.push(eq(tables.mainVenues.owner, userId))
  }

  const [venue] = await (db as any)
    .update(tables.mainVenues)
    .set({
      ...updates,
      updatedBy: userId
    })
    .where(and(...conditions))
    .returning()

  if (!venue) {
    throw createError({
      status: 404,
      statusText: 'MainVenue not found or unauthorized'
    })
  }

  return venue
}

export async function deleteMainVenue(
  recordId: string,
  teamId: string,
  userId: string,
  options?: { role?: string }
) {
  const db = useDB()
  const isAdmin = options?.role === 'admin' || options?.role === 'owner'

  const conditions = [
    eq(tables.mainVenues.id, recordId),
    eq(tables.mainVenues.teamId, teamId),
  ]
  if (!isAdmin) {
    conditions.push(eq(tables.mainVenues.owner, userId))
  }

  const [deleted] = await (db as any)
    .delete(tables.mainVenues)
    .where(and(...conditions))
    .returning()

  if (!deleted) {
    throw createError({
      status: 404,
      statusText: 'MainVenue not found or unauthorized'
    })
  }

  return { success: true }
}