// Generated with JSON field post-processing support (v2025-01-11)
import { eq, and, desc, inArray, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/sqlite-core'
import * as tables from './schema'
import type { InboxCard, NewInboxCard } from '../../types'
import { user } from '~~/server/db/schema'

// Overload order matters: the paginated signature (required `limit`) must come
// first so non-paginated calls fall through to the array overload.
export async function getAllInboxCards(teamId: string, opts: { owner?: string; createdBy?: string; updatedBy?: string; limit: number; offset?: number }): Promise<{ items: any[]; total: number }>
export async function getAllInboxCards(teamId: string, opts?: { owner?: string; createdBy?: string; updatedBy?: string }): Promise<any[]>
export async function getAllInboxCards(teamId: string, opts: { owner?: string; createdBy?: string; updatedBy?: string; limit?: number; offset?: number } = {}) {
  const db = useDB()

  const ownerUser = alias(user as any, 'ownerUser')
  const createdByUser = alias(user as any, 'createdByUser')
  const updatedByUser = alias(user as any, 'updatedByUser')
  const conditions = [eq(tables.inboxCards.teamId, teamId)]
  if (opts.owner) conditions.push(eq(tables.inboxCards.owner, opts.owner))
  if (opts.createdBy) conditions.push(eq(tables.inboxCards.createdBy, opts.createdBy))
  if (opts.updatedBy) conditions.push(eq(tables.inboxCards.updatedBy, opts.updatedBy))
  const whereExpr = and(...conditions)

  let listQuery = (db as any)
    .select({
      ...tables.inboxCards,
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
    .from(tables.inboxCards)
    .leftJoin(ownerUser, eq(tables.inboxCards.owner, ownerUser.id))
    .leftJoin(createdByUser, eq(tables.inboxCards.createdBy, createdByUser.id))
    .leftJoin(updatedByUser, eq(tables.inboxCards.updatedBy, updatedByUser.id))
    .where(whereExpr)
    .orderBy(desc(tables.inboxCards.createdAt))

  if (opts.limit != null) {
    listQuery = listQuery.limit(opts.limit).offset(opts.offset ?? 0)
  }

  const cards = await listQuery

  // Post-query processing for JSON fields (repeater/json types)
  cards.forEach((item: any) => {
      // payload is already parsed by jsonColumn.fromDriver; only default it
      if (item.payload === null || item.payload === undefined) {
        item.payload = null
      }
  })

  if (opts.limit != null) {
    const [countRow] = await (db as any)
      .select({ count: sql`count(*)` })
      .from(tables.inboxCards)
      .where(whereExpr)
    return { items: cards, total: Number(countRow?.count ?? 0) }
  }

  return cards
}

export async function getInboxCardsByIds(teamId: string, cardIds: string[]) {
  const db = useDB()

  const ownerUser = alias(user as any, 'ownerUser')
  const createdByUser = alias(user as any, 'createdByUser')
  const updatedByUser = alias(user as any, 'updatedByUser')

  const cards = await (db as any)
    .select({
      ...tables.inboxCards,
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
    .from(tables.inboxCards)
    .leftJoin(ownerUser, eq(tables.inboxCards.owner, ownerUser.id))
    .leftJoin(createdByUser, eq(tables.inboxCards.createdBy, createdByUser.id))
    .leftJoin(updatedByUser, eq(tables.inboxCards.updatedBy, updatedByUser.id))
    .where(
      and(
        eq(tables.inboxCards.teamId, teamId),
        inArray(tables.inboxCards.id, cardIds)
      )
    )
    .orderBy(desc(tables.inboxCards.createdAt))

  // Post-query processing for JSON fields (repeater/json types)
  cards.forEach((item: any) => {
      // payload is already parsed by jsonColumn.fromDriver; only default it
      if (item.payload === null || item.payload === undefined) {
        item.payload = null
      }
  })

  return cards
}

export async function createInboxCard(data: NewInboxCard) {
  const db = useDB()

  const [card] = await (db as any)
    .insert(tables.inboxCards)
    .values(data)
    .returning()

  return card
}

export async function updateInboxCard(
  recordId: string,
  teamId: string,
  userId: string,
  updates: Partial<InboxCard>,
  options?: { role?: string }
) {
  const db = useDB()
  const isAdmin = options?.role === 'admin' || options?.role === 'owner'

  const conditions = [
    eq(tables.inboxCards.id, recordId),
    eq(tables.inboxCards.teamId, teamId),
  ]
  if (!isAdmin) {
    conditions.push(eq(tables.inboxCards.owner, userId))
  }

  const [card] = await (db as any)
    .update(tables.inboxCards)
    .set({
      ...updates,
      updatedBy: userId
    })
    .where(and(...conditions))
    .returning()

  if (!card) {
    throw createError({
      status: 404,
      statusText: 'InboxCard not found or unauthorized'
    })
  }

  return card
}

export async function deleteInboxCard(
  recordId: string,
  teamId: string,
  userId: string,
  options?: { role?: string }
) {
  const db = useDB()
  const isAdmin = options?.role === 'admin' || options?.role === 'owner'

  const conditions = [
    eq(tables.inboxCards.id, recordId),
    eq(tables.inboxCards.teamId, teamId),
  ]
  if (!isAdmin) {
    conditions.push(eq(tables.inboxCards.owner, userId))
  }

  const [deleted] = await (db as any)
    .delete(tables.inboxCards)
    .where(and(...conditions))
    .returning()

  if (!deleted) {
    throw createError({
      status: 404,
      statusText: 'InboxCard not found or unauthorized'
    })
  }

  return { success: true }
}