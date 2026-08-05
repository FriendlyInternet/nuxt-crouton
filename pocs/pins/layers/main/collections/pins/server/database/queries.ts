// Generated with JSON field post-processing support (v2025-01-11)
import { eq, and, desc, inArray, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/sqlite-core'
import * as tables from './schema'
import type { MainPin, NewMainPin } from '../../types'
import { user } from '~~/server/db/schema'

// Overload order matters: the paginated signature (required `limit`) must come
// first so non-paginated calls fall through to the array overload.
export async function getAllMainPins(teamId: string, opts: { limit: number; offset?: number }): Promise<{ items: any[]; total: number }>
export async function getAllMainPins(teamId: string, opts?: {}): Promise<any[]>
export async function getAllMainPins(teamId: string, opts: { limit?: number; offset?: number } = {}) {
  const db = useDB()

  const ownerUser = alias(user as any, 'ownerUser')
  const createdByUser = alias(user as any, 'createdByUser')
  const updatedByUser = alias(user as any, 'updatedByUser')
  const conditions = [eq(tables.mainPins.teamId, teamId)]
  const whereExpr = and(...conditions)

  let listQuery = (db as any)
    .select({
      ...tables.mainPins,
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
    .from(tables.mainPins)
    .leftJoin(ownerUser, eq(tables.mainPins.owner, ownerUser.id))
    .leftJoin(createdByUser, eq(tables.mainPins.createdBy, createdByUser.id))
    .leftJoin(updatedByUser, eq(tables.mainPins.updatedBy, updatedByUser.id))
    .where(whereExpr)
    .orderBy(desc(tables.mainPins.createdAt))

  if (opts.limit != null) {
    listQuery = listQuery.limit(opts.limit).offset(opts.offset ?? 0)
  }

  const pins = await listQuery

  if (opts.limit != null) {
    const [countRow] = await (db as any)
      .select({ count: sql`count(*)` })
      .from(tables.mainPins)
      .where(whereExpr)
    return { items: pins, total: Number(countRow?.count ?? 0) }
  }

  return pins
}

export async function getMainPinsByIds(teamId: string, pinIds: string[]) {
  const db = useDB()

  const ownerUser = alias(user as any, 'ownerUser')
  const createdByUser = alias(user as any, 'createdByUser')
  const updatedByUser = alias(user as any, 'updatedByUser')

  const pins = await (db as any)
    .select({
      ...tables.mainPins,
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
    .from(tables.mainPins)
    .leftJoin(ownerUser, eq(tables.mainPins.owner, ownerUser.id))
    .leftJoin(createdByUser, eq(tables.mainPins.createdBy, createdByUser.id))
    .leftJoin(updatedByUser, eq(tables.mainPins.updatedBy, updatedByUser.id))
    .where(
      and(
        eq(tables.mainPins.teamId, teamId),
        inArray(tables.mainPins.id, pinIds)
      )
    )
    .orderBy(desc(tables.mainPins.createdAt))

  return pins
}

export async function createMainPin(data: NewMainPin) {
  const db = useDB()

  const [pin] = await (db as any)
    .insert(tables.mainPins)
    .values(data)
    .returning()

  return pin
}

export async function updateMainPin(
  recordId: string,
  teamId: string,
  userId: string,
  updates: Partial<MainPin>,
  options?: { role?: string }
) {
  const db = useDB()
  const isAdmin = options?.role === 'admin' || options?.role === 'owner'

  const conditions = [
    eq(tables.mainPins.id, recordId),
    eq(tables.mainPins.teamId, teamId),
  ]
  if (!isAdmin) {
    conditions.push(eq(tables.mainPins.owner, userId))
  }

  const [pin] = await (db as any)
    .update(tables.mainPins)
    .set({
      ...updates,
      updatedBy: userId
    })
    .where(and(...conditions))
    .returning()

  if (!pin) {
    throw createError({
      status: 404,
      statusText: 'MainPin not found or unauthorized'
    })
  }

  return pin
}

export async function deleteMainPin(
  recordId: string,
  teamId: string,
  userId: string,
  options?: { role?: string }
) {
  const db = useDB()
  const isAdmin = options?.role === 'admin' || options?.role === 'owner'

  const conditions = [
    eq(tables.mainPins.id, recordId),
    eq(tables.mainPins.teamId, teamId),
  ]
  if (!isAdmin) {
    conditions.push(eq(tables.mainPins.owner, userId))
  }

  const [deleted] = await (db as any)
    .delete(tables.mainPins)
    .where(and(...conditions))
    .returning()

  if (!deleted) {
    throw createError({
      status: 404,
      statusText: 'MainPin not found or unauthorized'
    })
  }

  return { success: true }
}