// Generated with JSON field post-processing support (v2025-01-11)
import { eq, and, desc, inArray, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/sqlite-core'
import * as tables from './schema'
import type { WidgetPart, NewWidgetPart } from '../../types'
import { user } from '~~/server/db/schema'

// Overload order matters: the paginated signature (required `limit`) must come
// first so non-paginated calls fall through to the array overload.
export async function getAllWidgetParts(teamId: string, opts: { limit: number; offset?: number }): Promise<{ items: any[]; total: number }>
export async function getAllWidgetParts(teamId: string, opts?: {}): Promise<any[]>
export async function getAllWidgetParts(teamId: string, opts: { limit?: number; offset?: number } = {}) {
  const db = useDB()

  const ownerUser = alias(user as any, 'ownerUser')
  const createdByUser = alias(user as any, 'createdByUser')
  const updatedByUser = alias(user as any, 'updatedByUser')
  const conditions = [eq(tables.widgetParts.teamId, teamId)]
  const whereExpr = and(...conditions)

  let listQuery = (db as any)
    .select({
      ...tables.widgetParts,
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
    .from(tables.widgetParts)
    .leftJoin(ownerUser, eq(tables.widgetParts.owner, ownerUser.id))
    .leftJoin(createdByUser, eq(tables.widgetParts.createdBy, createdByUser.id))
    .leftJoin(updatedByUser, eq(tables.widgetParts.updatedBy, updatedByUser.id))
    .where(whereExpr)
    .orderBy(desc(tables.widgetParts.createdAt))

  if (opts.limit != null) {
    listQuery = listQuery.limit(opts.limit).offset(opts.offset ?? 0)
  }

  const parts = await listQuery

  if (opts.limit != null) {
    const [countRow] = await (db as any)
      .select({ count: sql`count(*)` })
      .from(tables.widgetParts)
      .where(whereExpr)
    return { items: parts, total: Number(countRow?.count ?? 0) }
  }

  return parts
}

export async function getWidgetPartsByIds(teamId: string, partIds: string[]) {
  const db = useDB()

  const ownerUser = alias(user as any, 'ownerUser')
  const createdByUser = alias(user as any, 'createdByUser')
  const updatedByUser = alias(user as any, 'updatedByUser')

  const parts = await (db as any)
    .select({
      ...tables.widgetParts,
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
    .from(tables.widgetParts)
    .leftJoin(ownerUser, eq(tables.widgetParts.owner, ownerUser.id))
    .leftJoin(createdByUser, eq(tables.widgetParts.createdBy, createdByUser.id))
    .leftJoin(updatedByUser, eq(tables.widgetParts.updatedBy, updatedByUser.id))
    .where(
      and(
        eq(tables.widgetParts.teamId, teamId),
        inArray(tables.widgetParts.id, partIds)
      )
    )
    .orderBy(desc(tables.widgetParts.createdAt))

  return parts
}

export async function createWidgetPart(data: NewWidgetPart) {
  const db = useDB()

  const [part] = await (db as any)
    .insert(tables.widgetParts)
    .values(data)
    .returning()

  return part
}

export async function updateWidgetPart(
  recordId: string,
  teamId: string,
  userId: string,
  updates: Partial<WidgetPart>,
  options?: { role?: string }
) {
  const db = useDB()
  const isAdmin = options?.role === 'admin' || options?.role === 'owner'

  const conditions = [
    eq(tables.widgetParts.id, recordId),
    eq(tables.widgetParts.teamId, teamId),
  ]
  if (!isAdmin) {
    conditions.push(eq(tables.widgetParts.owner, userId))
  }

  const [part] = await (db as any)
    .update(tables.widgetParts)
    .set({
      ...updates,
      updatedBy: userId
    })
    .where(and(...conditions))
    .returning()

  if (!part) {
    throw createError({
      status: 404,
      statusText: 'WidgetPart not found or unauthorized'
    })
  }

  return part
}

export async function deleteWidgetPart(
  recordId: string,
  teamId: string,
  userId: string,
  options?: { role?: string }
) {
  const db = useDB()
  const isAdmin = options?.role === 'admin' || options?.role === 'owner'

  const conditions = [
    eq(tables.widgetParts.id, recordId),
    eq(tables.widgetParts.teamId, teamId),
  ]
  if (!isAdmin) {
    conditions.push(eq(tables.widgetParts.owner, userId))
  }

  const [deleted] = await (db as any)
    .delete(tables.widgetParts)
    .where(and(...conditions))
    .returning()

  if (!deleted) {
    throw createError({
      status: 404,
      statusText: 'WidgetPart not found or unauthorized'
    })
  }

  return { success: true }
}