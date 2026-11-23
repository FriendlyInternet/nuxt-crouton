// Generated with JSON field post-processing support (v2025-01-11)
import { eq, and, desc, asc, inArray, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/sqlite-core'
import * as tables from './schema'
import type { PipelineItem, NewPipelineItem } from '../../types'
import { user } from '~~/server/db/schema'

// Overload order matters: the paginated signature (required `limit`) must come
// first so non-paginated calls fall through to the array overload.
export async function getAllPipelineItems(teamId: string, opts: { owner?: string; createdBy?: string; updatedBy?: string; limit: number; offset?: number }): Promise<{ items: any[]; total: number }>
export async function getAllPipelineItems(teamId: string, opts?: { owner?: string; createdBy?: string; updatedBy?: string }): Promise<any[]>
export async function getAllPipelineItems(teamId: string, opts: { owner?: string; createdBy?: string; updatedBy?: string; limit?: number; offset?: number } = {}) {
  const db = useDB()

  const ownerUser = alias(user as any, 'ownerUser')
  const createdByUser = alias(user as any, 'createdByUser')
  const updatedByUser = alias(user as any, 'updatedByUser')
  const conditions = [eq(tables.pipelineItems.teamId, teamId)]
  if (opts.owner) conditions.push(eq(tables.pipelineItems.owner, opts.owner))
  if (opts.createdBy) conditions.push(eq(tables.pipelineItems.createdBy, opts.createdBy))
  if (opts.updatedBy) conditions.push(eq(tables.pipelineItems.updatedBy, opts.updatedBy))
  const whereExpr = and(...conditions)

  let listQuery = (db as any)
    .select({
      ...tables.pipelineItems,
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
    .from(tables.pipelineItems)
    .leftJoin(ownerUser, eq(tables.pipelineItems.owner, ownerUser.id))
    .leftJoin(createdByUser, eq(tables.pipelineItems.createdBy, createdByUser.id))
    .leftJoin(updatedByUser, eq(tables.pipelineItems.updatedBy, updatedByUser.id))
    .where(whereExpr)
    .orderBy(asc(tables.pipelineItems.order), desc(tables.pipelineItems.createdAt))

  if (opts.limit != null) {
    listQuery = listQuery.limit(opts.limit).offset(opts.offset ?? 0)
  }

  const items = await listQuery

  if (opts.limit != null) {
    const [countRow] = await (db as any)
      .select({ count: sql`count(*)` })
      .from(tables.pipelineItems)
      .where(whereExpr)
    return { items: items, total: Number(countRow?.count ?? 0) }
  }

  return items
}

export async function getPipelineItemsByIds(teamId: string, itemIds: string[]) {
  const db = useDB()

  const ownerUser = alias(user as any, 'ownerUser')
  const createdByUser = alias(user as any, 'createdByUser')
  const updatedByUser = alias(user as any, 'updatedByUser')

  const items = await (db as any)
    .select({
      ...tables.pipelineItems,
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
    .from(tables.pipelineItems)
    .leftJoin(ownerUser, eq(tables.pipelineItems.owner, ownerUser.id))
    .leftJoin(createdByUser, eq(tables.pipelineItems.createdBy, createdByUser.id))
    .leftJoin(updatedByUser, eq(tables.pipelineItems.updatedBy, updatedByUser.id))
    .where(
      and(
        eq(tables.pipelineItems.teamId, teamId),
        inArray(tables.pipelineItems.id, itemIds)
      )
    )
    .orderBy(asc(tables.pipelineItems.order), desc(tables.pipelineItems.createdAt))

  return items
}

export async function createPipelineItem(data: NewPipelineItem) {
  const db = useDB()

  const [item] = await (db as any)
    .insert(tables.pipelineItems)
    .values(data)
    .returning()

  return item
}

export async function updatePipelineItem(
  recordId: string,
  teamId: string,
  userId: string,
  updates: Partial<PipelineItem>,
  options?: { role?: string }
) {
  const db = useDB()
  const isAdmin = options?.role === 'admin' || options?.role === 'owner'

  const conditions = [
    eq(tables.pipelineItems.id, recordId),
    eq(tables.pipelineItems.teamId, teamId),
  ]
  if (!isAdmin) {
    conditions.push(eq(tables.pipelineItems.owner, userId))
  }

  const [item] = await (db as any)
    .update(tables.pipelineItems)
    .set({
      ...updates,
      updatedBy: userId
    })
    .where(and(...conditions))
    .returning()

  if (!item) {
    throw createError({
      status: 404,
      statusText: 'PipelineItem not found or unauthorized'
    })
  }

  return item
}

export async function deletePipelineItem(
  recordId: string,
  teamId: string,
  userId: string,
  options?: { role?: string }
) {
  const db = useDB()
  const isAdmin = options?.role === 'admin' || options?.role === 'owner'

  const conditions = [
    eq(tables.pipelineItems.id, recordId),
    eq(tables.pipelineItems.teamId, teamId),
  ]
  if (!isAdmin) {
    conditions.push(eq(tables.pipelineItems.owner, userId))
  }

  const [deleted] = await (db as any)
    .delete(tables.pipelineItems)
    .where(and(...conditions))
    .returning()

  if (!deleted) {
    throw createError({
      status: 404,
      statusText: 'PipelineItem not found or unauthorized'
    })
  }

  return { success: true }
}

// Sortable reorder queries (auto-generated when sortable: true)

export async function reorderSiblingsPipelineItems(
  teamId: string,
  updates: { id: string; order: number }[]
) {
  const db = useDB()

  const results = await Promise.all(
    updates.map(({ id, order }) =>
      (db as any)
        .update(tables.pipelineItems)
        .set({ order })
        .where(
          and(
            eq(tables.pipelineItems.id, id),
            eq(tables.pipelineItems.teamId, teamId)
          )
        )
        .returning()
    )
  )

  return { success: true, updated: results.flat().length }
}