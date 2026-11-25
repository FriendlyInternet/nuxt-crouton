// Generated with JSON field post-processing support (v2025-01-11)
import { eq, and, desc, inArray, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/sqlite-core'
import * as tables from './schema'
import type { SpikeTask, NewSpikeTask } from '../../types'
import { user } from '~~/server/db/schema'

// Overload order matters: the paginated signature (required `limit`) must come
// first so non-paginated calls fall through to the array overload.
export async function getAllSpikeTasks(teamId: string, opts: { owner?: string; createdBy?: string; updatedBy?: string; limit: number; offset?: number }): Promise<{ items: any[]; total: number }>
export async function getAllSpikeTasks(teamId: string, opts?: { owner?: string; createdBy?: string; updatedBy?: string }): Promise<any[]>
export async function getAllSpikeTasks(teamId: string, opts: { owner?: string; createdBy?: string; updatedBy?: string; limit?: number; offset?: number } = {}) {
  const db = useDB()

  const ownerUser = alias(user as any, 'ownerUser')
  const createdByUser = alias(user as any, 'createdByUser')
  const updatedByUser = alias(user as any, 'updatedByUser')
  const conditions = [eq(tables.spikeTasks.teamId, teamId)]
  if (opts.owner) conditions.push(eq(tables.spikeTasks.owner, opts.owner))
  if (opts.createdBy) conditions.push(eq(tables.spikeTasks.createdBy, opts.createdBy))
  if (opts.updatedBy) conditions.push(eq(tables.spikeTasks.updatedBy, opts.updatedBy))
  const whereExpr = and(...conditions)

  let listQuery = (db as any)
    .select({
      ...tables.spikeTasks,
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
    .from(tables.spikeTasks)
    .leftJoin(ownerUser, eq(tables.spikeTasks.owner, ownerUser.id))
    .leftJoin(createdByUser, eq(tables.spikeTasks.createdBy, createdByUser.id))
    .leftJoin(updatedByUser, eq(tables.spikeTasks.updatedBy, updatedByUser.id))
    .where(whereExpr)
    .orderBy(desc(tables.spikeTasks.createdAt))

  if (opts.limit != null) {
    listQuery = listQuery.limit(opts.limit).offset(opts.offset ?? 0)
  }

  const tasks = await listQuery

  if (opts.limit != null) {
    const [countRow] = await (db as any)
      .select({ count: sql`count(*)` })
      .from(tables.spikeTasks)
      .where(whereExpr)
    return { items: tasks, total: Number(countRow?.count ?? 0) }
  }

  return tasks
}

export async function getSpikeTasksByIds(teamId: string, taskIds: string[]) {
  const db = useDB()

  const ownerUser = alias(user as any, 'ownerUser')
  const createdByUser = alias(user as any, 'createdByUser')
  const updatedByUser = alias(user as any, 'updatedByUser')

  const tasks = await (db as any)
    .select({
      ...tables.spikeTasks,
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
    .from(tables.spikeTasks)
    .leftJoin(ownerUser, eq(tables.spikeTasks.owner, ownerUser.id))
    .leftJoin(createdByUser, eq(tables.spikeTasks.createdBy, createdByUser.id))
    .leftJoin(updatedByUser, eq(tables.spikeTasks.updatedBy, updatedByUser.id))
    .where(
      and(
        eq(tables.spikeTasks.teamId, teamId),
        inArray(tables.spikeTasks.id, taskIds)
      )
    )
    .orderBy(desc(tables.spikeTasks.createdAt))

  return tasks
}

export async function createSpikeTask(data: NewSpikeTask) {
  const db = useDB()

  const [task] = await (db as any)
    .insert(tables.spikeTasks)
    .values(data)
    .returning()

  return task
}

export async function updateSpikeTask(
  recordId: string,
  teamId: string,
  userId: string,
  updates: Partial<SpikeTask>,
  options?: { role?: string }
) {
  const db = useDB()
  const isAdmin = options?.role === 'admin' || options?.role === 'owner'

  const conditions = [
    eq(tables.spikeTasks.id, recordId),
    eq(tables.spikeTasks.teamId, teamId),
  ]
  if (!isAdmin) {
    conditions.push(eq(tables.spikeTasks.owner, userId))
  }

  const [task] = await (db as any)
    .update(tables.spikeTasks)
    .set({
      ...updates,
      updatedBy: userId
    })
    .where(and(...conditions))
    .returning()

  if (!task) {
    throw createError({
      status: 404,
      statusText: 'SpikeTask not found or unauthorized'
    })
  }

  return task
}

export async function deleteSpikeTask(
  recordId: string,
  teamId: string,
  userId: string,
  options?: { role?: string }
) {
  const db = useDB()
  const isAdmin = options?.role === 'admin' || options?.role === 'owner'

  const conditions = [
    eq(tables.spikeTasks.id, recordId),
    eq(tables.spikeTasks.teamId, teamId),
  ]
  if (!isAdmin) {
    conditions.push(eq(tables.spikeTasks.owner, userId))
  }

  const [deleted] = await (db as any)
    .delete(tables.spikeTasks)
    .where(and(...conditions))
    .returning()

  if (!deleted) {
    throw createError({
      status: 404,
      statusText: 'SpikeTask not found or unauthorized'
    })
  }

  return { success: true }
}