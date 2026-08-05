// Generated with JSON field post-processing support (v2025-01-11)
import { eq, and, desc, inArray, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/sqlite-core'
import * as tables from './schema'
import type { ChoresChore, NewChoresChore } from '../../types'
import * as usersSchema from '../../../users/server/database/schema'

// Overload order matters: the paginated signature (required `limit`) must come
// first so non-paginated calls fall through to the array overload.
export async function getAllChoresChores(teamId: string, opts: { assigneeId?: string; lastDoneById?: string; limit: number; offset?: number }): Promise<{ items: any[]; total: number }>
export async function getAllChoresChores(teamId: string, opts?: { assigneeId?: string; lastDoneById?: string }): Promise<any[]>
export async function getAllChoresChores(teamId: string, opts: { assigneeId?: string; lastDoneById?: string; limit?: number; offset?: number } = {}) {
  const db = useDB()

  const ownerUser = alias(user as any, 'ownerUser')
  const createdByUser = alias(user as any, 'createdByUser')
  const updatedByUser = alias(user as any, 'updatedByUser')
  const conditions = [eq(tables.choresChores.teamId, teamId)]
  if (opts.assigneeId) conditions.push(eq(tables.choresChores.assigneeId, opts.assigneeId))
  if (opts.lastDoneById) conditions.push(eq(tables.choresChores.lastDoneById, opts.lastDoneById))
  const whereExpr = and(...conditions)

  let listQuery = (db as any)
    .select({
      ...tables.choresChores,
      assigneeIdData: usersSchema.choresUsers,
      lastDoneByIdData: usersSchema.choresUsers,
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
    .from(tables.choresChores)
    .leftJoin(usersSchema.choresUsers, eq(tables.choresChores.assigneeId, usersSchema.choresUsers.id))
    .leftJoin(usersSchema.choresUsers, eq(tables.choresChores.lastDoneById, usersSchema.choresUsers.id))
    .leftJoin(ownerUser, eq(tables.choresChores.owner, ownerUser.id))
    .leftJoin(createdByUser, eq(tables.choresChores.createdBy, createdByUser.id))
    .leftJoin(updatedByUser, eq(tables.choresChores.updatedBy, updatedByUser.id))
    .where(whereExpr)
    .orderBy(desc(tables.choresChores.createdAt))

  if (opts.limit != null) {
    listQuery = listQuery.limit(opts.limit).offset(opts.offset ?? 0)
  }

  const chores = await listQuery

  if (opts.limit != null) {
    const [countRow] = await (db as any)
      .select({ count: sql`count(*)` })
      .from(tables.choresChores)
      .where(whereExpr)
    return { items: chores, total: Number(countRow?.count ?? 0) }
  }

  return chores
}

export async function getChoresChoresByIds(teamId: string, choreIds: string[]) {
  const db = useDB()

  const ownerUser = alias(user as any, 'ownerUser')
  const createdByUser = alias(user as any, 'createdByUser')
  const updatedByUser = alias(user as any, 'updatedByUser')

  const chores = await (db as any)
    .select({
      ...tables.choresChores,
      assigneeIdData: usersSchema.choresUsers,
      lastDoneByIdData: usersSchema.choresUsers,
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
    .from(tables.choresChores)
    .leftJoin(usersSchema.choresUsers, eq(tables.choresChores.assigneeId, usersSchema.choresUsers.id))
    .leftJoin(usersSchema.choresUsers, eq(tables.choresChores.lastDoneById, usersSchema.choresUsers.id))
    .leftJoin(ownerUser, eq(tables.choresChores.owner, ownerUser.id))
    .leftJoin(createdByUser, eq(tables.choresChores.createdBy, createdByUser.id))
    .leftJoin(updatedByUser, eq(tables.choresChores.updatedBy, updatedByUser.id))
    .where(
      and(
        eq(tables.choresChores.teamId, teamId),
        inArray(tables.choresChores.id, choreIds)
      )
    )
    .orderBy(desc(tables.choresChores.createdAt))

  return chores
}

export async function createChoresChore(data: NewChoresChore) {
  const db = useDB()

  const [chore] = await (db as any)
    .insert(tables.choresChores)
    .values(data)
    .returning()

  return chore
}

export async function updateChoresChore(
  recordId: string,
  teamId: string,
  userId: string,
  updates: Partial<ChoresChore>,
  options?: { role?: string }
) {
  const db = useDB()
  const isAdmin = options?.role === 'admin' || options?.role === 'owner'

  const conditions = [
    eq(tables.choresChores.id, recordId),
    eq(tables.choresChores.teamId, teamId),
  ]
  if (!isAdmin) {
    conditions.push(eq(tables.choresChores.owner, userId))
  }

  const [chore] = await (db as any)
    .update(tables.choresChores)
    .set({
      ...updates,
      updatedBy: userId
    })
    .where(and(...conditions))
    .returning()

  if (!chore) {
    throw createError({
      status: 404,
      statusText: 'ChoresChore not found or unauthorized'
    })
  }

  return chore
}

export async function deleteChoresChore(
  recordId: string,
  teamId: string,
  userId: string,
  options?: { role?: string }
) {
  const db = useDB()
  const isAdmin = options?.role === 'admin' || options?.role === 'owner'

  const conditions = [
    eq(tables.choresChores.id, recordId),
    eq(tables.choresChores.teamId, teamId),
  ]
  if (!isAdmin) {
    conditions.push(eq(tables.choresChores.owner, userId))
  }

  const [deleted] = await (db as any)
    .delete(tables.choresChores)
    .where(and(...conditions))
    .returning()

  if (!deleted) {
    throw createError({
      status: 404,
      statusText: 'ChoresChore not found or unauthorized'
    })
  }

  return { success: true }
}