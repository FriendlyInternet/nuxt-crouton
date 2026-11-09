// Generated with JSON field post-processing support (v2025-01-11)
import { eq, and, desc, inArray, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/sqlite-core'
import * as tables from './schema'
import type { MainMembernote, NewMainMembernote } from '../../types'
import { user } from '~~/server/db/schema'

// Overload order matters: the paginated signature (required `limit`) must come
// first so non-paginated calls fall through to the array overload.
export async function getAllMainMembernotes(teamId: string, opts: { owner?: string; createdBy?: string; updatedBy?: string; ownerId?: string; limit: number; offset?: number }): Promise<{ items: any[]; total: number }>
export async function getAllMainMembernotes(teamId: string, opts?: { owner?: string; createdBy?: string; updatedBy?: string; ownerId?: string }): Promise<any[]>
export async function getAllMainMembernotes(teamId: string, opts: { owner?: string; createdBy?: string; updatedBy?: string; ownerId?: string; limit?: number; offset?: number } = {}) {
  const db = useDB()

  const ownerUser = alias(user as any, 'ownerUser')
  const createdByUser = alias(user as any, 'createdByUser')
  const updatedByUser = alias(user as any, 'updatedByUser')
  const conditions = [eq(tables.mainMembernotes.teamId, teamId)]
  if (opts.owner) conditions.push(eq(tables.mainMembernotes.owner, opts.owner))
  if (opts.createdBy) conditions.push(eq(tables.mainMembernotes.createdBy, opts.createdBy))
  if (opts.updatedBy) conditions.push(eq(tables.mainMembernotes.updatedBy, opts.updatedBy))
  if (opts.ownerId) conditions.push(eq(tables.mainMembernotes.owner, opts.ownerId))
  const whereExpr = and(...conditions)

  let listQuery = (db as any)
    .select({
      ...tables.mainMembernotes,
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
    .from(tables.mainMembernotes)
    .leftJoin(ownerUser, eq(tables.mainMembernotes.owner, ownerUser.id))
    .leftJoin(createdByUser, eq(tables.mainMembernotes.createdBy, createdByUser.id))
    .leftJoin(updatedByUser, eq(tables.mainMembernotes.updatedBy, updatedByUser.id))
    .where(whereExpr)
    .orderBy(desc(tables.mainMembernotes.createdAt))

  if (opts.limit != null) {
    listQuery = listQuery.limit(opts.limit).offset(opts.offset ?? 0)
  }

  const membernotes = await listQuery

  if (opts.limit != null) {
    const [countRow] = await (db as any)
      .select({ count: sql`count(*)` })
      .from(tables.mainMembernotes)
      .where(whereExpr)
    return { items: membernotes, total: Number(countRow?.count ?? 0) }
  }

  return membernotes
}

export async function getMainMembernotesByIds(teamId: string, membernoteIds: string[], ownerId?: string) {
  const db = useDB()

  const ownerUser = alias(user as any, 'ownerUser')
  const createdByUser = alias(user as any, 'createdByUser')
  const updatedByUser = alias(user as any, 'updatedByUser')

  const membernotes = await (db as any)
    .select({
      ...tables.mainMembernotes,
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
    .from(tables.mainMembernotes)
    .leftJoin(ownerUser, eq(tables.mainMembernotes.owner, ownerUser.id))
    .leftJoin(createdByUser, eq(tables.mainMembernotes.createdBy, createdByUser.id))
    .leftJoin(updatedByUser, eq(tables.mainMembernotes.updatedBy, updatedByUser.id))
    .where(
      and(
        eq(tables.mainMembernotes.teamId, teamId),
        inArray(tables.mainMembernotes.id, membernoteIds),
        ...(ownerId ? [eq(tables.mainMembernotes.owner, ownerId)] : [])
      )
    )
    .orderBy(desc(tables.mainMembernotes.createdAt))

  return membernotes
}

export async function createMainMembernote(data: NewMainMembernote) {
  const db = useDB()

  const [membernote] = await (db as any)
    .insert(tables.mainMembernotes)
    .values(data)
    .returning()

  return membernote
}

export async function updateMainMembernote(
  recordId: string,
  teamId: string,
  userId: string,
  updates: Partial<MainMembernote>,
  options?: { role?: string }
) {
  const db = useDB()
  const isAdmin = options?.role === 'admin' || options?.role === 'owner'

  const conditions = [
    eq(tables.mainMembernotes.id, recordId),
    eq(tables.mainMembernotes.teamId, teamId),
  ]
  if (!isAdmin) {
    conditions.push(eq(tables.mainMembernotes.owner, userId))
  }

  const [membernote] = await (db as any)
    .update(tables.mainMembernotes)
    .set({
      ...updates,
      updatedBy: userId
    })
    .where(and(...conditions))
    .returning()

  if (!membernote) {
    throw createError({
      status: 404,
      statusText: 'MainMembernote not found or unauthorized'
    })
  }

  return membernote
}

export async function deleteMainMembernote(
  recordId: string,
  teamId: string,
  userId: string,
  options?: { role?: string }
) {
  const db = useDB()
  const isAdmin = options?.role === 'admin' || options?.role === 'owner'

  const conditions = [
    eq(tables.mainMembernotes.id, recordId),
    eq(tables.mainMembernotes.teamId, teamId),
  ]
  if (!isAdmin) {
    conditions.push(eq(tables.mainMembernotes.owner, userId))
  }

  const [deleted] = await (db as any)
    .delete(tables.mainMembernotes)
    .where(and(...conditions))
    .returning()

  if (!deleted) {
    throw createError({
      status: 404,
      statusText: 'MainMembernote not found or unauthorized'
    })
  }

  return { success: true }
}

export const MainMembernotesAccess = {"create":"member","list":"own"} as const