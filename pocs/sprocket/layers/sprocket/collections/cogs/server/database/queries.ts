// Generated with JSON field post-processing support (v2025-01-11)
import { eq, and, desc, inArray, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/sqlite-core'
import * as tables from './schema'
import type { SprocketCog, NewSprocketCog } from '../../types'
import { user } from '~~/server/db/schema'

// Overload order matters: the paginated signature (required `limit`) must come
// first so non-paginated calls fall through to the array overload.
export async function getAllSprocketCogs(teamId: string, opts: { limit: number; offset?: number }): Promise<{ items: any[]; total: number }>
export async function getAllSprocketCogs(teamId: string, opts?: {}): Promise<any[]>
export async function getAllSprocketCogs(teamId: string, opts: { limit?: number; offset?: number } = {}) {
  const db = useDB()

  const ownerUser = alias(user as any, 'ownerUser')
  const createdByUser = alias(user as any, 'createdByUser')
  const updatedByUser = alias(user as any, 'updatedByUser')
  const conditions = [eq(tables.sprocketCogs.teamId, teamId)]
  const whereExpr = and(...conditions)

  let listQuery = (db as any)
    .select({
      ...tables.sprocketCogs,
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
    .from(tables.sprocketCogs)
    .leftJoin(ownerUser, eq(tables.sprocketCogs.owner, ownerUser.id))
    .leftJoin(createdByUser, eq(tables.sprocketCogs.createdBy, createdByUser.id))
    .leftJoin(updatedByUser, eq(tables.sprocketCogs.updatedBy, updatedByUser.id))
    .where(whereExpr)
    .orderBy(desc(tables.sprocketCogs.createdAt))

  if (opts.limit != null) {
    listQuery = listQuery.limit(opts.limit).offset(opts.offset ?? 0)
  }

  const cogs = await listQuery

  if (opts.limit != null) {
    const [countRow] = await (db as any)
      .select({ count: sql`count(*)` })
      .from(tables.sprocketCogs)
      .where(whereExpr)
    return { items: cogs, total: Number(countRow?.count ?? 0) }
  }

  return cogs
}

export async function getSprocketCogsByIds(teamId: string, cogIds: string[]) {
  const db = useDB()

  const ownerUser = alias(user as any, 'ownerUser')
  const createdByUser = alias(user as any, 'createdByUser')
  const updatedByUser = alias(user as any, 'updatedByUser')

  const cogs = await (db as any)
    .select({
      ...tables.sprocketCogs,
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
    .from(tables.sprocketCogs)
    .leftJoin(ownerUser, eq(tables.sprocketCogs.owner, ownerUser.id))
    .leftJoin(createdByUser, eq(tables.sprocketCogs.createdBy, createdByUser.id))
    .leftJoin(updatedByUser, eq(tables.sprocketCogs.updatedBy, updatedByUser.id))
    .where(
      and(
        eq(tables.sprocketCogs.teamId, teamId),
        inArray(tables.sprocketCogs.id, cogIds)
      )
    )
    .orderBy(desc(tables.sprocketCogs.createdAt))

  return cogs
}

export async function createSprocketCog(data: NewSprocketCog) {
  const db = useDB()

  const [cog] = await (db as any)
    .insert(tables.sprocketCogs)
    .values(data)
    .returning()

  return cog
}

export async function updateSprocketCog(
  recordId: string,
  teamId: string,
  userId: string,
  updates: Partial<SprocketCog>,
  options?: { role?: string }
) {
  const db = useDB()
  const isAdmin = options?.role === 'admin' || options?.role === 'owner'

  const conditions = [
    eq(tables.sprocketCogs.id, recordId),
    eq(tables.sprocketCogs.teamId, teamId),
  ]
  if (!isAdmin) {
    conditions.push(eq(tables.sprocketCogs.owner, userId))
  }

  const [cog] = await (db as any)
    .update(tables.sprocketCogs)
    .set({
      ...updates,
      updatedBy: userId
    })
    .where(and(...conditions))
    .returning()

  if (!cog) {
    throw createError({
      status: 404,
      statusText: 'SprocketCog not found or unauthorized'
    })
  }

  return cog
}

export async function deleteSprocketCog(
  recordId: string,
  teamId: string,
  userId: string,
  options?: { role?: string }
) {
  const db = useDB()
  const isAdmin = options?.role === 'admin' || options?.role === 'owner'

  const conditions = [
    eq(tables.sprocketCogs.id, recordId),
    eq(tables.sprocketCogs.teamId, teamId),
  ]
  if (!isAdmin) {
    conditions.push(eq(tables.sprocketCogs.owner, userId))
  }

  const [deleted] = await (db as any)
    .delete(tables.sprocketCogs)
    .where(and(...conditions))
    .returning()

  if (!deleted) {
    throw createError({
      status: 404,
      statusText: 'SprocketCog not found or unauthorized'
    })
  }

  return { success: true }
}