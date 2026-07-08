// Generated with JSON field post-processing support (v2025-01-11)
import { eq, and, desc, inArray, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/sqlite-core'
import * as tables from './schema'
import type { MainNote, NewMainNote } from '../../types'
import { user } from '~~/server/db/schema'

// Overload order matters: the paginated signature (required `limit`) must come
// first so non-paginated calls fall through to the array overload.
export async function getAllMainNotes(teamId: string, opts: { limit: number; offset?: number }): Promise<{ items: any[]; total: number }>
export async function getAllMainNotes(teamId: string, opts?: {}): Promise<any[]>
export async function getAllMainNotes(teamId: string, opts: { limit?: number; offset?: number } = {}) {
  const db = useDB()

  const ownerUser = alias(user as any, 'ownerUser')
  const createdByUser = alias(user as any, 'createdByUser')
  const updatedByUser = alias(user as any, 'updatedByUser')
  const conditions = [eq(tables.mainNotes.teamId, teamId)]
  const whereExpr = and(...conditions)

  let listQuery = (db as any)
    .select({
      ...tables.mainNotes,
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
    .from(tables.mainNotes)
    .leftJoin(ownerUser, eq(tables.mainNotes.owner, ownerUser.id))
    .leftJoin(createdByUser, eq(tables.mainNotes.createdBy, createdByUser.id))
    .leftJoin(updatedByUser, eq(tables.mainNotes.updatedBy, updatedByUser.id))
    .where(whereExpr)
    .orderBy(desc(tables.mainNotes.createdAt))

  if (opts.limit != null) {
    listQuery = listQuery.limit(opts.limit).offset(opts.offset ?? 0)
  }

  const notes = await listQuery

  if (opts.limit != null) {
    const [countRow] = await (db as any)
      .select({ count: sql`count(*)` })
      .from(tables.mainNotes)
      .where(whereExpr)
    return { items: notes, total: Number(countRow?.count ?? 0) }
  }

  return notes
}

export async function getMainNotesByIds(teamId: string, noteIds: string[]) {
  const db = useDB()

  const ownerUser = alias(user as any, 'ownerUser')
  const createdByUser = alias(user as any, 'createdByUser')
  const updatedByUser = alias(user as any, 'updatedByUser')

  const notes = await (db as any)
    .select({
      ...tables.mainNotes,
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
    .from(tables.mainNotes)
    .leftJoin(ownerUser, eq(tables.mainNotes.owner, ownerUser.id))
    .leftJoin(createdByUser, eq(tables.mainNotes.createdBy, createdByUser.id))
    .leftJoin(updatedByUser, eq(tables.mainNotes.updatedBy, updatedByUser.id))
    .where(
      and(
        eq(tables.mainNotes.teamId, teamId),
        inArray(tables.mainNotes.id, noteIds)
      )
    )
    .orderBy(desc(tables.mainNotes.createdAt))

  return notes
}

export async function createMainNote(data: NewMainNote) {
  const db = useDB()

  const [note] = await (db as any)
    .insert(tables.mainNotes)
    .values(data)
    .returning()

  return note
}

export async function updateMainNote(
  recordId: string,
  teamId: string,
  userId: string,
  updates: Partial<MainNote>,
  options?: { role?: string }
) {
  const db = useDB()
  const isAdmin = options?.role === 'admin' || options?.role === 'owner'

  const conditions = [
    eq(tables.mainNotes.id, recordId),
    eq(tables.mainNotes.teamId, teamId),
  ]
  if (!isAdmin) {
    conditions.push(eq(tables.mainNotes.owner, userId))
  }

  const [note] = await (db as any)
    .update(tables.mainNotes)
    .set({
      ...updates,
      updatedBy: userId
    })
    .where(and(...conditions))
    .returning()

  if (!note) {
    throw createError({
      status: 404,
      statusText: 'MainNote not found or unauthorized'
    })
  }

  return note
}

export async function deleteMainNote(
  recordId: string,
  teamId: string,
  userId: string,
  options?: { role?: string }
) {
  const db = useDB()
  const isAdmin = options?.role === 'admin' || options?.role === 'owner'

  const conditions = [
    eq(tables.mainNotes.id, recordId),
    eq(tables.mainNotes.teamId, teamId),
  ]
  if (!isAdmin) {
    conditions.push(eq(tables.mainNotes.owner, userId))
  }

  const [deleted] = await (db as any)
    .delete(tables.mainNotes)
    .where(and(...conditions))
    .returning()

  if (!deleted) {
    throw createError({
      status: 404,
      statusText: 'MainNote not found or unauthorized'
    })
  }

  return { success: true }
}