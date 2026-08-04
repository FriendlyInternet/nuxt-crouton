// Generated with JSON field post-processing support (v2025-01-11)
import { eq, and, desc, inArray, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/sqlite-core'
import * as tables from './schema'
import type { MainWidget, NewMainWidget } from '../../types'
import { user } from '~~/server/db/schema'

// Overload order matters: the paginated signature (required `limit`) must come
// first so non-paginated calls fall through to the array overload.
export async function getAllMainWidgets(teamId: string, opts: { limit: number; offset?: number }): Promise<{ items: any[]; total: number }>
export async function getAllMainWidgets(teamId: string, opts?: {}): Promise<any[]>
export async function getAllMainWidgets(teamId: string, opts: { limit?: number; offset?: number } = {}) {
  const db = useDB()

  const ownerUser = alias(user as any, 'ownerUser')
  const createdByUser = alias(user as any, 'createdByUser')
  const updatedByUser = alias(user as any, 'updatedByUser')
  const conditions = [eq(tables.mainWidgets.teamId, teamId)]
  const whereExpr = and(...conditions)

  let listQuery = (db as any)
    .select({
      ...tables.mainWidgets,
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
    .from(tables.mainWidgets)
    .leftJoin(ownerUser, eq(tables.mainWidgets.owner, ownerUser.id))
    .leftJoin(createdByUser, eq(tables.mainWidgets.createdBy, createdByUser.id))
    .leftJoin(updatedByUser, eq(tables.mainWidgets.updatedBy, updatedByUser.id))
    .where(whereExpr)
    .orderBy(desc(tables.mainWidgets.createdAt))

  if (opts.limit != null) {
    listQuery = listQuery.limit(opts.limit).offset(opts.offset ?? 0)
  }

  const widgets = await listQuery

  if (opts.limit != null) {
    const [countRow] = await (db as any)
      .select({ count: sql`count(*)` })
      .from(tables.mainWidgets)
      .where(whereExpr)
    return { items: widgets, total: Number(countRow?.count ?? 0) }
  }

  return widgets
}

export async function getMainWidgetsByIds(teamId: string, widgetIds: string[]) {
  const db = useDB()

  const ownerUser = alias(user as any, 'ownerUser')
  const createdByUser = alias(user as any, 'createdByUser')
  const updatedByUser = alias(user as any, 'updatedByUser')

  const widgets = await (db as any)
    .select({
      ...tables.mainWidgets,
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
    .from(tables.mainWidgets)
    .leftJoin(ownerUser, eq(tables.mainWidgets.owner, ownerUser.id))
    .leftJoin(createdByUser, eq(tables.mainWidgets.createdBy, createdByUser.id))
    .leftJoin(updatedByUser, eq(tables.mainWidgets.updatedBy, updatedByUser.id))
    .where(
      and(
        eq(tables.mainWidgets.teamId, teamId),
        inArray(tables.mainWidgets.id, widgetIds)
      )
    )
    .orderBy(desc(tables.mainWidgets.createdAt))

  return widgets
}

export async function createMainWidget(data: NewMainWidget) {
  const db = useDB()

  const [widget] = await (db as any)
    .insert(tables.mainWidgets)
    .values(data)
    .returning()

  return widget
}

export async function updateMainWidget(
  recordId: string,
  teamId: string,
  userId: string,
  updates: Partial<MainWidget>,
  options?: { role?: string }
) {
  const db = useDB()
  const isAdmin = options?.role === 'admin' || options?.role === 'owner'

  const conditions = [
    eq(tables.mainWidgets.id, recordId),
    eq(tables.mainWidgets.teamId, teamId),
  ]
  if (!isAdmin) {
    conditions.push(eq(tables.mainWidgets.owner, userId))
  }

  const [widget] = await (db as any)
    .update(tables.mainWidgets)
    .set({
      ...updates,
      updatedBy: userId
    })
    .where(and(...conditions))
    .returning()

  if (!widget) {
    throw createError({
      status: 404,
      statusText: 'MainWidget not found or unauthorized'
    })
  }

  return widget
}

export async function deleteMainWidget(
  recordId: string,
  teamId: string,
  userId: string,
  options?: { role?: string }
) {
  const db = useDB()
  const isAdmin = options?.role === 'admin' || options?.role === 'owner'

  const conditions = [
    eq(tables.mainWidgets.id, recordId),
    eq(tables.mainWidgets.teamId, teamId),
  ]
  if (!isAdmin) {
    conditions.push(eq(tables.mainWidgets.owner, userId))
  }

  const [deleted] = await (db as any)
    .delete(tables.mainWidgets)
    .where(and(...conditions))
    .returning()

  if (!deleted) {
    throw createError({
      status: 404,
      statusText: 'MainWidget not found or unauthorized'
    })
  }

  return { success: true }
}