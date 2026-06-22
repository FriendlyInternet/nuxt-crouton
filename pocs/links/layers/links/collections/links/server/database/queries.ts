// Generated with standard CRUD support
import { eq, and, desc, inArray, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/sqlite-core'
import * as tables from './schema'
import type { Link, NewLink } from '../../types'
import { user } from '~~/server/db/schema'

// Overload order matters: the paginated signature (required `limit`) must come
// first so non-paginated calls fall through to the array overload.
export async function getAllLinks(teamId: string, opts: { limit: number; offset?: number }): Promise<{ items: any[]; total: number }>
export async function getAllLinks(teamId: string, opts?: {}): Promise<any[]>
export async function getAllLinks(teamId: string, opts: { limit?: number; offset?: number } = {}) {
  const db = useDB()

  const ownerUser = alias(user as any, 'ownerUser')
  const createdByUser = alias(user as any, 'createdByUser')
  const updatedByUser = alias(user as any, 'updatedByUser')
  const conditions = [eq(tables.links.teamId, teamId)]
  const whereExpr = and(...conditions)

  let listQuery = (db as any)
    .select({
      ...tables.links,
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
    .from(tables.links)
    .leftJoin(ownerUser, eq(tables.links.owner, ownerUser.id))
    .leftJoin(createdByUser, eq(tables.links.createdBy, createdByUser.id))
    .leftJoin(updatedByUser, eq(tables.links.updatedBy, updatedByUser.id))
    .where(whereExpr)
    .orderBy(desc(tables.links.createdAt))

  if (opts.limit != null) {
    listQuery = listQuery.limit(opts.limit).offset(opts.offset ?? 0)
  }

  const rows = await listQuery

  if (opts.limit != null) {
    const [countRow] = await (db as any)
      .select({ count: sql`count(*)` })
      .from(tables.links)
      .where(whereExpr)
    return { items: rows, total: Number(countRow?.count ?? 0) }
  }

  return rows
}

export async function getLinksByIds(teamId: string, linkIds: string[]) {
  const db = useDB()

  const ownerUser = alias(user as any, 'ownerUser')
  const createdByUser = alias(user as any, 'createdByUser')
  const updatedByUser = alias(user as any, 'updatedByUser')

  const rows = await (db as any)
    .select({
      ...tables.links,
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
    .from(tables.links)
    .leftJoin(ownerUser, eq(tables.links.owner, ownerUser.id))
    .leftJoin(createdByUser, eq(tables.links.createdBy, createdByUser.id))
    .leftJoin(updatedByUser, eq(tables.links.updatedBy, updatedByUser.id))
    .where(
      and(
        eq(tables.links.teamId, teamId),
        inArray(tables.links.id, linkIds)
      )
    )
    .orderBy(desc(tables.links.createdAt))

  return rows
}

export async function createLink(data: NewLink) {
  const db = useDB()

  const [link] = await (db as any)
    .insert(tables.links)
    .values(data)
    .returning()

  return link
}

export async function updateLink(
  recordId: string,
  teamId: string,
  userId: string,
  updates: Partial<Link>,
  options?: { role?: string }
) {
  const db = useDB()
  const isAdmin = options?.role === 'admin' || options?.role === 'owner'

  const conditions = [
    eq(tables.links.id, recordId),
    eq(tables.links.teamId, teamId),
  ]
  if (!isAdmin) {
    conditions.push(eq(tables.links.owner, userId))
  }

  const [link] = await (db as any)
    .update(tables.links)
    .set({
      ...updates,
      updatedBy: userId
    })
    .where(and(...conditions))
    .returning()

  if (!link) {
    throw createError({
      status: 404,
      statusText: 'Link not found or unauthorized'
    })
  }

  return link
}

export async function deleteLink(
  recordId: string,
  teamId: string,
  userId: string,
  options?: { role?: string }
) {
  const db = useDB()
  const isAdmin = options?.role === 'admin' || options?.role === 'owner'

  const conditions = [
    eq(tables.links.id, recordId),
    eq(tables.links.teamId, teamId),
  ]
  if (!isAdmin) {
    conditions.push(eq(tables.links.owner, userId))
  }

  const [deleted] = await (db as any)
    .delete(tables.links)
    .where(and(...conditions))
    .returning()

  if (!deleted) {
    throw createError({
      status: 404,
      statusText: 'Link not found or unauthorized'
    })
  }

  return { success: true }
}
