// Generated with JSON field post-processing support (v2025-01-11)
import { eq, and, desc, inArray, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/sqlite-core'
import * as tables from './schema'
import type { CrateLookup, NewCrateLookup } from '../../types'
import * as tracksSchema from '../../../tracks/server/database/schema'
import { user } from '~~/server/db/schema'

// Overload order matters: the paginated signature (required `limit`) must come
// first so non-paginated calls fall through to the array overload.
export async function getAllCrateLookups(teamId: string, opts: { trackId?: string; owner?: string; createdBy?: string; updatedBy?: string; limit: number; offset?: number }): Promise<{ items: any[]; total: number }>
export async function getAllCrateLookups(teamId: string, opts?: { trackId?: string; owner?: string; createdBy?: string; updatedBy?: string }): Promise<any[]>
export async function getAllCrateLookups(teamId: string, opts: { trackId?: string; owner?: string; createdBy?: string; updatedBy?: string; limit?: number; offset?: number } = {}) {
  const db = useDB()

  const ownerUser = alias(user as any, 'ownerUser')
  const createdByUser = alias(user as any, 'createdByUser')
  const updatedByUser = alias(user as any, 'updatedByUser')
  const conditions = [eq(tables.crateLookups.teamId, teamId)]
  if (opts.trackId) conditions.push(eq(tables.crateLookups.trackId, opts.trackId))
  if (opts.owner) conditions.push(eq(tables.crateLookups.owner, opts.owner))
  if (opts.createdBy) conditions.push(eq(tables.crateLookups.createdBy, opts.createdBy))
  if (opts.updatedBy) conditions.push(eq(tables.crateLookups.updatedBy, opts.updatedBy))
  const whereExpr = and(...conditions)

  let listQuery = (db as any)
    .select({
      ...tables.crateLookups,
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
    .from(tables.crateLookups)
    .leftJoin(tracksSchema.crateTracks, eq(tables.crateLookups.trackId, tracksSchema.crateTracks.id))
    .leftJoin(ownerUser, eq(tables.crateLookups.owner, ownerUser.id))
    .leftJoin(createdByUser, eq(tables.crateLookups.createdBy, createdByUser.id))
    .leftJoin(updatedByUser, eq(tables.crateLookups.updatedBy, updatedByUser.id))
    .where(whereExpr)
    .orderBy(desc(tables.crateLookups.createdAt))

  if (opts.limit != null) {
    listQuery = listQuery.limit(opts.limit).offset(opts.offset ?? 0)
  }

  const lookups = await listQuery

  // Post-query processing for JSON fields (repeater/json types)
  lookups.forEach((item: any) => {
      // Parse results from JSON string
      if (typeof item.results === 'string') {
        try {
          item.results = JSON.parse(item.results)
        } catch (e) {
          console.error('Error parsing results:', e)
          item.results = null
        }
      }
      if (item.results === null || item.results === undefined) {
        item.results = null
      }
  })

  if (opts.limit != null) {
    const [countRow] = await (db as any)
      .select({ count: sql`count(*)` })
      .from(tables.crateLookups)
      .where(whereExpr)
    return { items: lookups, total: Number(countRow?.count ?? 0) }
  }

  return lookups
}

export async function getCrateLookupsByIds(teamId: string, lookupIds: string[]) {
  const db = useDB()

  const ownerUser = alias(user as any, 'ownerUser')
  const createdByUser = alias(user as any, 'createdByUser')
  const updatedByUser = alias(user as any, 'updatedByUser')

  const lookups = await (db as any)
    .select({
      ...tables.crateLookups,
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
    .from(tables.crateLookups)
    .leftJoin(tracksSchema.crateTracks, eq(tables.crateLookups.trackId, tracksSchema.crateTracks.id))
    .leftJoin(ownerUser, eq(tables.crateLookups.owner, ownerUser.id))
    .leftJoin(createdByUser, eq(tables.crateLookups.createdBy, createdByUser.id))
    .leftJoin(updatedByUser, eq(tables.crateLookups.updatedBy, updatedByUser.id))
    .where(
      and(
        eq(tables.crateLookups.teamId, teamId),
        inArray(tables.crateLookups.id, lookupIds)
      )
    )
    .orderBy(desc(tables.crateLookups.createdAt))

  // Post-query processing for JSON fields (repeater/json types)
  lookups.forEach((item: any) => {
      // Parse results from JSON string
      if (typeof item.results === 'string') {
        try {
          item.results = JSON.parse(item.results)
        } catch (e) {
          console.error('Error parsing results:', e)
          item.results = null
        }
      }
      if (item.results === null || item.results === undefined) {
        item.results = null
      }
  })

  return lookups
}

export async function createCrateLookup(data: NewCrateLookup) {
  const db = useDB()

  const [lookup] = await (db as any)
    .insert(tables.crateLookups)
    .values(data)
    .returning()

  return lookup
}

export async function updateCrateLookup(
  recordId: string,
  teamId: string,
  userId: string,
  updates: Partial<CrateLookup>,
  options?: { role?: string }
) {
  const db = useDB()
  const isAdmin = options?.role === 'admin' || options?.role === 'owner'

  const conditions = [
    eq(tables.crateLookups.id, recordId),
    eq(tables.crateLookups.teamId, teamId),
  ]
  if (!isAdmin) {
    conditions.push(eq(tables.crateLookups.owner, userId))
  }

  const [lookup] = await (db as any)
    .update(tables.crateLookups)
    .set({
      ...updates,
      updatedBy: userId
    })
    .where(and(...conditions))
    .returning()

  if (!lookup) {
    throw createError({
      status: 404,
      statusText: 'CrateLookup not found or unauthorized'
    })
  }

  return lookup
}

export async function deleteCrateLookup(
  recordId: string,
  teamId: string,
  userId: string,
  options?: { role?: string }
) {
  const db = useDB()
  const isAdmin = options?.role === 'admin' || options?.role === 'owner'

  const conditions = [
    eq(tables.crateLookups.id, recordId),
    eq(tables.crateLookups.teamId, teamId),
  ]
  if (!isAdmin) {
    conditions.push(eq(tables.crateLookups.owner, userId))
  }

  const [deleted] = await (db as any)
    .delete(tables.crateLookups)
    .where(and(...conditions))
    .returning()

  if (!deleted) {
    throw createError({
      status: 404,
      statusText: 'CrateLookup not found or unauthorized'
    })
  }

  return { success: true }
}