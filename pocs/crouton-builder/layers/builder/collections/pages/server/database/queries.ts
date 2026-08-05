// Generated with JSON field post-processing support (v2025-01-11)
import { eq, and, desc, asc, inArray, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/sqlite-core'
import * as tables from './schema'
import type { BuilderPage, NewBuilderPage } from '../../types'
import { user } from '~~/server/db/schema'

// Overload order matters: the paginated signature (required `limit`) must come
// first so non-paginated calls fall through to the array overload.
export async function getAllBuilderPages(teamId: string, opts: { limit: number; offset?: number }): Promise<{ items: any[]; total: number }>
export async function getAllBuilderPages(teamId: string, opts?: {}): Promise<any[]>
export async function getAllBuilderPages(teamId: string, opts: { limit?: number; offset?: number } = {}) {
  const db = useDB()

  const ownerUser = alias(user as any, 'ownerUser')
  const createdByUser = alias(user as any, 'createdByUser')
  const updatedByUser = alias(user as any, 'updatedByUser')
  const conditions = [eq(tables.builderPages.teamId, teamId)]
  const whereExpr = and(...conditions)

  let listQuery = (db as any)
    .select({
      ...tables.builderPages,
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
    .from(tables.builderPages)
    .leftJoin(ownerUser, eq(tables.builderPages.owner, ownerUser.id))
    .leftJoin(createdByUser, eq(tables.builderPages.createdBy, createdByUser.id))
    .leftJoin(updatedByUser, eq(tables.builderPages.updatedBy, updatedByUser.id))
    .where(whereExpr)
    .orderBy(desc(tables.builderPages.createdAt))

  if (opts.limit != null) {
    listQuery = listQuery.limit(opts.limit).offset(opts.offset ?? 0)
  }

  const pages = await listQuery

  // Post-query processing for JSON fields (repeater/json types)
  pages.forEach((item: any) => {
      // Parse board from JSON string
      if (typeof item.board === 'string') {
        try {
          item.board = JSON.parse(item.board)
        } catch (e) {
          console.error('Error parsing board:', e)
          item.board = null
        }
      }
      if (item.board === null || item.board === undefined) {
        item.board = null
      }
  })

  if (opts.limit != null) {
    const [countRow] = await (db as any)
      .select({ count: sql`count(*)` })
      .from(tables.builderPages)
      .where(whereExpr)
    return { items: pages, total: Number(countRow?.count ?? 0) }
  }

  return pages
}

export async function getBuilderPagesByIds(teamId: string, pageIds: string[]) {
  const db = useDB()

  const ownerUser = alias(user as any, 'ownerUser')
  const createdByUser = alias(user as any, 'createdByUser')
  const updatedByUser = alias(user as any, 'updatedByUser')

  const pages = await (db as any)
    .select({
      ...tables.builderPages,
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
    .from(tables.builderPages)
    .leftJoin(ownerUser, eq(tables.builderPages.owner, ownerUser.id))
    .leftJoin(createdByUser, eq(tables.builderPages.createdBy, createdByUser.id))
    .leftJoin(updatedByUser, eq(tables.builderPages.updatedBy, updatedByUser.id))
    .where(
      and(
        eq(tables.builderPages.teamId, teamId),
        inArray(tables.builderPages.id, pageIds)
      )
    )
    .orderBy(desc(tables.builderPages.createdAt))

  // Post-query processing for JSON fields (repeater/json types)
  pages.forEach((item: any) => {
      // Parse board from JSON string
      if (typeof item.board === 'string') {
        try {
          item.board = JSON.parse(item.board)
        } catch (e) {
          console.error('Error parsing board:', e)
          item.board = null
        }
      }
      if (item.board === null || item.board === undefined) {
        item.board = null
      }
  })

  return pages
}

export async function createBuilderPage(data: NewBuilderPage) {
  const db = useDB()

  const [page] = await (db as any)
    .insert(tables.builderPages)
    .values(data)
    .returning()

  return page
}

export async function updateBuilderPage(
  recordId: string,
  teamId: string,
  userId: string,
  updates: Partial<BuilderPage>,
  options?: { role?: string }
) {
  const db = useDB()
  const isAdmin = options?.role === 'admin' || options?.role === 'owner'

  const conditions = [
    eq(tables.builderPages.id, recordId),
    eq(tables.builderPages.teamId, teamId),
  ]
  if (!isAdmin) {
    conditions.push(eq(tables.builderPages.owner, userId))
  }

  const [page] = await (db as any)
    .update(tables.builderPages)
    .set({
      ...updates,
      updatedBy: userId
    })
    .where(and(...conditions))
    .returning()

  if (!page) {
    throw createError({
      status: 404,
      statusText: 'BuilderPage not found or unauthorized'
    })
  }

  return page
}

export async function deleteBuilderPage(
  recordId: string,
  teamId: string,
  userId: string,
  options?: { role?: string }
) {
  const db = useDB()
  const isAdmin = options?.role === 'admin' || options?.role === 'owner'

  const conditions = [
    eq(tables.builderPages.id, recordId),
    eq(tables.builderPages.teamId, teamId),
  ]
  if (!isAdmin) {
    conditions.push(eq(tables.builderPages.owner, userId))
  }

  const [deleted] = await (db as any)
    .delete(tables.builderPages)
    .where(and(...conditions))
    .returning()

  if (!deleted) {
    throw createError({
      status: 404,
      statusText: 'BuilderPage not found or unauthorized'
    })
  }

  return { success: true }
}

// Tree hierarchy queries (auto-generated when hierarchy: true)
// Type: BuilderPage with hierarchy fields

interface TreeItem {
  id: string
  path: string
  depth: number
  order: number
  [key: string]: any
}

export async function getTreeDataBuilderPages(teamId: string) {
  const db = useDB()

  const pages = await (db as any)
    .select()
    .from(tables.builderPages)
    .where(eq(tables.builderPages.teamId, teamId))
    .orderBy(tables.builderPages.path, tables.builderPages.order)

  return pages as TreeItem[]
}

export async function updatePositionBuilderPage(
  teamId: string,
  id: string,
  newParentId: string | null,
  newOrder: number
) {
  const db = useDB()

  // Get the current item to find its path
  const [current] = await (db as any)
    .select()
    .from(tables.builderPages)
    .where(
      and(
        eq(tables.builderPages.id, id),
        eq(tables.builderPages.teamId, teamId)
      )
    ) as TreeItem[]

  if (!current) {
    throw createError({
      status: 404,
      statusText: 'BuilderPage not found'
    })
  }

  // Calculate new path and depth
  let newPath: string
  let newDepth: number

  if (newParentId) {
    const [parent] = await (db as any)
      .select()
      .from(tables.builderPages)
      .where(
        and(
          eq(tables.builderPages.id, newParentId),
          eq(tables.builderPages.teamId, teamId)
        )
      ) as TreeItem[]

    if (!parent) {
      throw createError({
        status: 400,
        statusText: 'Parent BuilderPage not found'
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
    .update(tables.builderPages)
    .set({
      parentId: newParentId,
      path: newPath,
      depth: newDepth,
      order: newOrder
    })
    .where(
      and(
        eq(tables.builderPages.id, id),
        eq(tables.builderPages.teamId, teamId)
      )
    )
    .returning()

  // Update all descendants' paths if the path changed
  if (oldPath !== newPath) {
    // Get all descendants
    const descendants = await (db as any)
      .select()
      .from(tables.builderPages)
      .where(
        and(
          eq(tables.builderPages.teamId, teamId),
          sql`${tables.builderPages.path} LIKE ${oldPath + '%'} AND ${tables.builderPages.id} != ${id}`
        )
      ) as TreeItem[]

    // Update each descendant's path and depth
    for (const descendant of descendants) {
      const descendantNewPath = descendant.path.replace(oldPath, newPath)
      const depthDiff = newDepth - current.depth

      await (db as any)
        .update(tables.builderPages)
        .set({
          path: descendantNewPath,
          depth: descendant.depth + depthDiff
        })
        .where(eq(tables.builderPages.id, descendant.id))
    }
  }

  return updated
}

export async function reorderSiblingsBuilderPages(
  teamId: string,
  updates: { id: string; order: number }[]
) {
  const db = useDB()

  const results = []

  for (const update of updates) {
    const [updated] = await (db as any)
      .update(tables.builderPages)
      .set({ order: update.order })
      .where(
        and(
          eq(tables.builderPages.id, update.id),
          eq(tables.builderPages.teamId, teamId)
        )
      )
      .returning()

    if (updated) {
      results.push(updated)
    }
  }

  return results
}