// Generated with JSON field post-processing support (v2025-01-11)
import { eq, and, desc, asc, inArray, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/sqlite-core'
import * as tables from './schema'
import type { CratePile, NewCratePile } from '../../types'
import { user } from '~~/server/db/schema'

// Overload order matters: the paginated signature (required `limit`) must come
// first so non-paginated calls fall through to the array overload.
export async function getAllCratePiles(teamId: string, opts: { owner?: string; createdBy?: string; updatedBy?: string; limit: number; offset?: number }): Promise<{ items: any[]; total: number }>
export async function getAllCratePiles(teamId: string, opts?: { owner?: string; createdBy?: string; updatedBy?: string }): Promise<any[]>
export async function getAllCratePiles(teamId: string, opts: { owner?: string; createdBy?: string; updatedBy?: string; limit?: number; offset?: number } = {}) {
  const db = useDB()

  const ownerUser = alias(user as any, 'ownerUser')
  const createdByUser = alias(user as any, 'createdByUser')
  const updatedByUser = alias(user as any, 'updatedByUser')
  const conditions = [eq(tables.cratePiles.teamId, teamId)]
  if (opts.owner) conditions.push(eq(tables.cratePiles.owner, opts.owner))
  if (opts.createdBy) conditions.push(eq(tables.cratePiles.createdBy, opts.createdBy))
  if (opts.updatedBy) conditions.push(eq(tables.cratePiles.updatedBy, opts.updatedBy))
  const whereExpr = and(...conditions)

  let listQuery = (db as any)
    .select({
      ...tables.cratePiles,
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
    .from(tables.cratePiles)
    .leftJoin(ownerUser, eq(tables.cratePiles.owner, ownerUser.id))
    .leftJoin(createdByUser, eq(tables.cratePiles.createdBy, createdByUser.id))
    .leftJoin(updatedByUser, eq(tables.cratePiles.updatedBy, updatedByUser.id))
    .where(whereExpr)
    .orderBy(desc(tables.cratePiles.createdAt))

  if (opts.limit != null) {
    listQuery = listQuery.limit(opts.limit).offset(opts.offset ?? 0)
  }

  const piles = await listQuery

  if (opts.limit != null) {
    const [countRow] = await (db as any)
      .select({ count: sql`count(*)` })
      .from(tables.cratePiles)
      .where(whereExpr)
    return { items: piles, total: Number(countRow?.count ?? 0) }
  }

  return piles
}

export async function getCratePilesByIds(teamId: string, pileIds: string[]) {
  const db = useDB()

  const ownerUser = alias(user as any, 'ownerUser')
  const createdByUser = alias(user as any, 'createdByUser')
  const updatedByUser = alias(user as any, 'updatedByUser')

  const piles = await (db as any)
    .select({
      ...tables.cratePiles,
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
    .from(tables.cratePiles)
    .leftJoin(ownerUser, eq(tables.cratePiles.owner, ownerUser.id))
    .leftJoin(createdByUser, eq(tables.cratePiles.createdBy, createdByUser.id))
    .leftJoin(updatedByUser, eq(tables.cratePiles.updatedBy, updatedByUser.id))
    .where(
      and(
        eq(tables.cratePiles.teamId, teamId),
        inArray(tables.cratePiles.id, pileIds)
      )
    )
    .orderBy(desc(tables.cratePiles.createdAt))

  return piles
}

export async function createCratePile(data: NewCratePile) {
  const db = useDB()

  const [pile] = await (db as any)
    .insert(tables.cratePiles)
    .values(data)
    .returning()

  return pile
}

export async function updateCratePile(
  recordId: string,
  teamId: string,
  userId: string,
  updates: Partial<CratePile>,
  options?: { role?: string }
) {
  const db = useDB()
  const isAdmin = options?.role === 'admin' || options?.role === 'owner'

  const conditions = [
    eq(tables.cratePiles.id, recordId),
    eq(tables.cratePiles.teamId, teamId),
  ]
  if (!isAdmin) {
    conditions.push(eq(tables.cratePiles.owner, userId))
  }

  const [pile] = await (db as any)
    .update(tables.cratePiles)
    .set({
      ...updates,
      updatedBy: userId
    })
    .where(and(...conditions))
    .returning()

  if (!pile) {
    throw createError({
      status: 404,
      statusText: 'CratePile not found or unauthorized'
    })
  }

  return pile
}

export async function deleteCratePile(
  recordId: string,
  teamId: string,
  userId: string,
  options?: { role?: string }
) {
  const db = useDB()
  const isAdmin = options?.role === 'admin' || options?.role === 'owner'

  const conditions = [
    eq(tables.cratePiles.id, recordId),
    eq(tables.cratePiles.teamId, teamId),
  ]
  if (!isAdmin) {
    conditions.push(eq(tables.cratePiles.owner, userId))
  }

  const [deleted] = await (db as any)
    .delete(tables.cratePiles)
    .where(and(...conditions))
    .returning()

  if (!deleted) {
    throw createError({
      status: 404,
      statusText: 'CratePile not found or unauthorized'
    })
  }

  return { success: true }
}

// Tree hierarchy queries (auto-generated when hierarchy: true)
// Type: CratePile with hierarchy fields

interface TreeItem {
  id: string
  path: string
  depth: number
  order: number
  [key: string]: any
}

export async function getTreeDataCratePiles(teamId: string) {
  const db = useDB()

  const piles = await (db as any)
    .select()
    .from(tables.cratePiles)
    .where(eq(tables.cratePiles.teamId, teamId))
    .orderBy(tables.cratePiles.path, tables.cratePiles.order)

  return piles as TreeItem[]
}

export async function updatePositionCratePile(
  teamId: string,
  id: string,
  newParentId: string | null,
  newOrder: number
) {
  const db = useDB()

  // Get the current item to find its path
  const [current] = await (db as any)
    .select()
    .from(tables.cratePiles)
    .where(
      and(
        eq(tables.cratePiles.id, id),
        eq(tables.cratePiles.teamId, teamId)
      )
    ) as TreeItem[]

  if (!current) {
    throw createError({
      status: 404,
      statusText: 'CratePile not found'
    })
  }

  // Calculate new path and depth
  let newPath: string
  let newDepth: number

  if (newParentId) {
    const [parent] = await (db as any)
      .select()
      .from(tables.cratePiles)
      .where(
        and(
          eq(tables.cratePiles.id, newParentId),
          eq(tables.cratePiles.teamId, teamId)
        )
      ) as TreeItem[]

    if (!parent) {
      throw createError({
        status: 400,
        statusText: 'Parent CratePile not found'
      })
    }

    // Prevent moving item to its own descendant
    if (parent.path.startsWith(current.path)) {
      throw createError({
        status: 400,
        statusText: 'Cannot move item to its own descendant'
      })
    }

    newPath = `${parent.path}${id}/`
    newDepth = parent.depth + 1
  } else {
    newPath = `/${id}/`
    newDepth = 0
  }

  const oldPath = current.path

  // Update the item itself
  const [updated] = await (db as any)
    .update(tables.cratePiles)
    .set({
      parentId: newParentId,
      path: newPath,
      depth: newDepth,
      order: newOrder
    })
    .where(
      and(
        eq(tables.cratePiles.id, id),
        eq(tables.cratePiles.teamId, teamId)
      )
    )
    .returning()

  // Update all descendants' paths if the path changed
  if (oldPath !== newPath) {
    // Get all descendants
    const descendants = await (db as any)
      .select()
      .from(tables.cratePiles)
      .where(
        and(
          eq(tables.cratePiles.teamId, teamId),
          sql`${tables.cratePiles.path} LIKE ${oldPath + '%'} AND ${tables.cratePiles.id} != ${id}`
        )
      ) as TreeItem[]

    // Update each descendant's path and depth
    for (const descendant of descendants) {
      const descendantNewPath = descendant.path.replace(oldPath, newPath)
      const depthDiff = newDepth - current.depth

      await (db as any)
        .update(tables.cratePiles)
        .set({
          path: descendantNewPath,
          depth: descendant.depth + depthDiff
        })
        .where(eq(tables.cratePiles.id, descendant.id))
    }
  }

  return updated
}

export async function reorderSiblingsCratePiles(
  teamId: string,
  updates: { id: string; order: number }[]
) {
  const db = useDB()

  const results = []

  for (const update of updates) {
    const [updated] = await (db as any)
      .update(tables.cratePiles)
      .set({ order: update.order })
      .where(
        and(
          eq(tables.cratePiles.id, update.id),
          eq(tables.cratePiles.teamId, teamId)
        )
      )
      .returning()

    if (updated) {
      results.push(updated)
    }
  }

  return results
}