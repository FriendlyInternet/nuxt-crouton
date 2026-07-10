// Generated with JSON field post-processing support (v2025-01-11)
import { eq, and, desc, inArray, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/sqlite-core'
import * as tables from './schema'
import type { MainSnippet, NewMainSnippet } from '../../types'
import { user } from '~~/server/db/schema'

// Overload order matters: the paginated signature (required `limit`) must come
// first so non-paginated calls fall through to the array overload.
export async function getAllMainSnippets(teamId: string, opts: { limit: number; offset?: number }): Promise<{ items: any[]; total: number }>
export async function getAllMainSnippets(teamId: string, opts?: {}): Promise<any[]>
export async function getAllMainSnippets(teamId: string, opts: { limit?: number; offset?: number } = {}) {
  const db = useDB()

  const ownerUser = alias(user as any, 'ownerUser')
  const createdByUser = alias(user as any, 'createdByUser')
  const updatedByUser = alias(user as any, 'updatedByUser')
  const conditions = [eq(tables.mainSnippets.teamId, teamId)]
  const whereExpr = and(...conditions)

  let listQuery = (db as any)
    .select({
      ...tables.mainSnippets,
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
    .from(tables.mainSnippets)
    .leftJoin(ownerUser, eq(tables.mainSnippets.owner, ownerUser.id))
    .leftJoin(createdByUser, eq(tables.mainSnippets.createdBy, createdByUser.id))
    .leftJoin(updatedByUser, eq(tables.mainSnippets.updatedBy, updatedByUser.id))
    .where(whereExpr)
    .orderBy(desc(tables.mainSnippets.createdAt))

  if (opts.limit != null) {
    listQuery = listQuery.limit(opts.limit).offset(opts.offset ?? 0)
  }

  const snippets = await listQuery

  if (opts.limit != null) {
    const [countRow] = await (db as any)
      .select({ count: sql`count(*)` })
      .from(tables.mainSnippets)
      .where(whereExpr)
    return { items: snippets, total: Number(countRow?.count ?? 0) }
  }

  return snippets
}

export async function getMainSnippetsByIds(teamId: string, snippetIds: string[]) {
  const db = useDB()

  const ownerUser = alias(user as any, 'ownerUser')
  const createdByUser = alias(user as any, 'createdByUser')
  const updatedByUser = alias(user as any, 'updatedByUser')

  const snippets = await (db as any)
    .select({
      ...tables.mainSnippets,
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
    .from(tables.mainSnippets)
    .leftJoin(ownerUser, eq(tables.mainSnippets.owner, ownerUser.id))
    .leftJoin(createdByUser, eq(tables.mainSnippets.createdBy, createdByUser.id))
    .leftJoin(updatedByUser, eq(tables.mainSnippets.updatedBy, updatedByUser.id))
    .where(
      and(
        eq(tables.mainSnippets.teamId, teamId),
        inArray(tables.mainSnippets.id, snippetIds)
      )
    )
    .orderBy(desc(tables.mainSnippets.createdAt))

  return snippets
}

export async function createMainSnippet(data: NewMainSnippet) {
  const db = useDB()

  const [snippet] = await (db as any)
    .insert(tables.mainSnippets)
    .values(data)
    .returning()

  return snippet
}

export async function updateMainSnippet(
  recordId: string,
  teamId: string,
  userId: string,
  updates: Partial<MainSnippet>,
  options?: { role?: string }
) {
  const db = useDB()
  const isAdmin = options?.role === 'admin' || options?.role === 'owner'

  const conditions = [
    eq(tables.mainSnippets.id, recordId),
    eq(tables.mainSnippets.teamId, teamId),
  ]
  if (!isAdmin) {
    conditions.push(eq(tables.mainSnippets.owner, userId))
  }

  const [snippet] = await (db as any)
    .update(tables.mainSnippets)
    .set({
      ...updates,
      updatedBy: userId
    })
    .where(and(...conditions))
    .returning()

  if (!snippet) {
    throw createError({
      status: 404,
      statusText: 'MainSnippet not found or unauthorized'
    })
  }

  return snippet
}

export async function deleteMainSnippet(
  recordId: string,
  teamId: string,
  userId: string,
  options?: { role?: string }
) {
  const db = useDB()
  const isAdmin = options?.role === 'admin' || options?.role === 'owner'

  const conditions = [
    eq(tables.mainSnippets.id, recordId),
    eq(tables.mainSnippets.teamId, teamId),
  ]
  if (!isAdmin) {
    conditions.push(eq(tables.mainSnippets.owner, userId))
  }

  const [deleted] = await (db as any)
    .delete(tables.mainSnippets)
    .where(and(...conditions))
    .returning()

  if (!deleted) {
    throw createError({
      status: 404,
      statusText: 'MainSnippet not found or unauthorized'
    })
  }

  return { success: true }
}