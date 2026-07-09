// Generated with JSON field post-processing support (v2025-01-11)
import { eq, and, desc, inArray, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/sqlite-core'
import * as tables from './schema'
import type { MainQuote, NewMainQuote } from '../../types'
import { user } from '~~/server/db/schema'

// Overload order matters: the paginated signature (required `limit`) must come
// first so non-paginated calls fall through to the array overload.
export async function getAllMainQuotes(teamId: string, opts: { limit: number; offset?: number }): Promise<{ items: any[]; total: number }>
export async function getAllMainQuotes(teamId: string, opts?: {}): Promise<any[]>
export async function getAllMainQuotes(teamId: string, opts: { limit?: number; offset?: number } = {}) {
  const db = useDB()

  const ownerUser = alias(user as any, 'ownerUser')
  const createdByUser = alias(user as any, 'createdByUser')
  const updatedByUser = alias(user as any, 'updatedByUser')
  const conditions = [eq(tables.mainQuotes.teamId, teamId)]
  const whereExpr = and(...conditions)

  let listQuery = (db as any)
    .select({
      ...tables.mainQuotes,
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
    .from(tables.mainQuotes)
    .leftJoin(ownerUser, eq(tables.mainQuotes.owner, ownerUser.id))
    .leftJoin(createdByUser, eq(tables.mainQuotes.createdBy, createdByUser.id))
    .leftJoin(updatedByUser, eq(tables.mainQuotes.updatedBy, updatedByUser.id))
    .where(whereExpr)
    .orderBy(desc(tables.mainQuotes.createdAt))

  if (opts.limit != null) {
    listQuery = listQuery.limit(opts.limit).offset(opts.offset ?? 0)
  }

  const quotes = await listQuery

  if (opts.limit != null) {
    const [countRow] = await (db as any)
      .select({ count: sql`count(*)` })
      .from(tables.mainQuotes)
      .where(whereExpr)
    return { items: quotes, total: Number(countRow?.count ?? 0) }
  }

  return quotes
}

export async function getMainQuotesByIds(teamId: string, quoteIds: string[]) {
  const db = useDB()

  const ownerUser = alias(user as any, 'ownerUser')
  const createdByUser = alias(user as any, 'createdByUser')
  const updatedByUser = alias(user as any, 'updatedByUser')

  const quotes = await (db as any)
    .select({
      ...tables.mainQuotes,
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
    .from(tables.mainQuotes)
    .leftJoin(ownerUser, eq(tables.mainQuotes.owner, ownerUser.id))
    .leftJoin(createdByUser, eq(tables.mainQuotes.createdBy, createdByUser.id))
    .leftJoin(updatedByUser, eq(tables.mainQuotes.updatedBy, updatedByUser.id))
    .where(
      and(
        eq(tables.mainQuotes.teamId, teamId),
        inArray(tables.mainQuotes.id, quoteIds)
      )
    )
    .orderBy(desc(tables.mainQuotes.createdAt))

  return quotes
}

export async function createMainQuote(data: NewMainQuote) {
  const db = useDB()

  const [quote] = await (db as any)
    .insert(tables.mainQuotes)
    .values(data)
    .returning()

  return quote
}

export async function updateMainQuote(
  recordId: string,
  teamId: string,
  userId: string,
  updates: Partial<MainQuote>,
  options?: { role?: string }
) {
  const db = useDB()
  const isAdmin = options?.role === 'admin' || options?.role === 'owner'

  const conditions = [
    eq(tables.mainQuotes.id, recordId),
    eq(tables.mainQuotes.teamId, teamId),
  ]
  if (!isAdmin) {
    conditions.push(eq(tables.mainQuotes.owner, userId))
  }

  const [quote] = await (db as any)
    .update(tables.mainQuotes)
    .set({
      ...updates,
      updatedBy: userId
    })
    .where(and(...conditions))
    .returning()

  if (!quote) {
    throw createError({
      status: 404,
      statusText: 'MainQuote not found or unauthorized'
    })
  }

  return quote
}

export async function deleteMainQuote(
  recordId: string,
  teamId: string,
  userId: string,
  options?: { role?: string }
) {
  const db = useDB()
  const isAdmin = options?.role === 'admin' || options?.role === 'owner'

  const conditions = [
    eq(tables.mainQuotes.id, recordId),
    eq(tables.mainQuotes.teamId, teamId),
  ]
  if (!isAdmin) {
    conditions.push(eq(tables.mainQuotes.owner, userId))
  }

  const [deleted] = await (db as any)
    .delete(tables.mainQuotes)
    .where(and(...conditions))
    .returning()

  if (!deleted) {
    throw createError({
      status: 404,
      statusText: 'MainQuote not found or unauthorized'
    })
  }

  return { success: true }
}