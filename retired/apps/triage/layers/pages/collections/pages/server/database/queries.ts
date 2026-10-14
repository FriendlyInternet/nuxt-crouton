// Generated with JSON field post-processing support (v2025-01-11)
import { eq, and, desc, asc, inArray, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/sqlite-core'
import * as tables from './schema'
import type { PagesPage, NewPagesPage } from '../../types'
import { user } from '~~/server/db/schema'

export async function getAllPagesPages(teamId: string) {
  const db = useDB()

  const ownerUser = alias(user as any, 'ownerUser')
  const createdByUser = alias(user as any, 'createdByUser')
  const updatedByUser = alias(user as any, 'updatedByUser')

  const pages = await (db as any)
    .select({
      ...tables.pagesPages,
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
    .from(tables.pagesPages)
    .leftJoin(ownerUser, eq(tables.pagesPages.owner, ownerUser.id))
    .leftJoin(createdByUser, eq(tables.pagesPages.createdBy, createdByUser.id))
    .leftJoin(updatedByUser, eq(tables.pagesPages.updatedBy, updatedByUser.id))
    .where(eq(tables.pagesPages.teamId, teamId))
    .orderBy(asc(tables.pagesPages.order), desc(tables.pagesPages.createdAt))

  // Post-query processing for JSON fields (repeater/json types)
  pages.forEach((item: any) => {
      // Parse config from JSON string
      if (typeof item.config === 'string') {
        try {
          item.config = JSON.parse(item.config)
        } catch (e) {
          console.error('Error parsing config:', e)
          item.config = null
        }
      }
      if (item.config === null || item.config === undefined) {
        item.config = null
      }
  })

  return pages
}

export async function getPagesPagesByIds(teamId: string, pageIds: string[]) {
  const db = useDB()

  const ownerUser = alias(user as any, 'ownerUser')
  const createdByUser = alias(user as any, 'createdByUser')
  const updatedByUser = alias(user as any, 'updatedByUser')

  const pages = await (db as any)
    .select({
      ...tables.pagesPages,
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
    .from(tables.pagesPages)
    .leftJoin(ownerUser, eq(tables.pagesPages.owner, ownerUser.id))
    .leftJoin(createdByUser, eq(tables.pagesPages.createdBy, createdByUser.id))
    .leftJoin(updatedByUser, eq(tables.pagesPages.updatedBy, updatedByUser.id))
    .where(
      and(
        eq(tables.pagesPages.teamId, teamId),
        inArray(tables.pagesPages.id, pageIds)
      )
    )
    .orderBy(asc(tables.pagesPages.order), desc(tables.pagesPages.createdAt))

  // Post-query processing for JSON fields (repeater/json types)
  pages.forEach((item: any) => {
      // Parse config from JSON string
      if (typeof item.config === 'string') {
        try {
          item.config = JSON.parse(item.config)
        } catch (e) {
          console.error('Error parsing config:', e)
          item.config = null
        }
      }
      if (item.config === null || item.config === undefined) {
        item.config = null
      }
  })

  return pages
}

export async function createPagesPage(data: NewPagesPage) {
  const db = useDB()

  const [page] = await (db as any)
    .insert(tables.pagesPages)
    .values(data)
    .returning()

  return page
}

export async function updatePagesPage(
  recordId: string,
  teamId: string,
  userId: string,
  updates: Partial<PagesPage>,
  options?: { role?: string }
) {
  const db = useDB()
  const isAdmin = options?.role === 'admin' || options?.role === 'owner'

  const conditions = [
    eq(tables.pagesPages.id, recordId),
    eq(tables.pagesPages.teamId, teamId),
  ]
  if (!isAdmin) {
    conditions.push(eq(tables.pagesPages.owner, userId))
  }

  const [page] = await (db as any)
    .update(tables.pagesPages)
    .set({
      ...updates,
      updatedBy: userId
    })
    .where(and(...conditions))
    .returning()

  if (!page) {
    throw createError({
      status: 404,
      statusText: 'PagesPage not found or unauthorized'
    })
  }

  return page
}

export async function deletePagesPage(
  recordId: string,
  teamId: string,
  userId: string,
  options?: { role?: string }
) {
  const db = useDB()
  const isAdmin = options?.role === 'admin' || options?.role === 'owner'

  const conditions = [
    eq(tables.pagesPages.id, recordId),
    eq(tables.pagesPages.teamId, teamId),
  ]
  if (!isAdmin) {
    conditions.push(eq(tables.pagesPages.owner, userId))
  }

  const [deleted] = await (db as any)
    .delete(tables.pagesPages)
    .where(and(...conditions))
    .returning()

  if (!deleted) {
    throw createError({
      status: 404,
      statusText: 'PagesPage not found or unauthorized'
    })
  }

  return { success: true }
}

// Tree hierarchy queries (auto-generated when hierarchy: true)
// Type: PagesPage with hierarchy fields

interface TreeItem {
  id: string
  path: string
  depth: number
  order: number
  [key: string]: any
}

export async function getTreeDataPagesPages(teamId: string) {
  const db = useDB()

  const pages = await (db as any)
    .select()
    .from(tables.pagesPages)
    .where(eq(tables.pagesPages.teamId, teamId))
    .orderBy(tables.pagesPages.path, tables.pagesPages.order)

  return pages as TreeItem[]
}

export async function updatePositionPagesPage(
  teamId: string,
  id: string,
  newParentId: string | null,
  newOrder: number
) {
  const db = useDB()

  // Get the current item to find its path
  const [current] = await (db as any)
    .select()
    .from(tables.pagesPages)
    .where(
      and(
        eq(tables.pagesPages.id, id),
        eq(tables.pagesPages.teamId, teamId)
      )
    ) as TreeItem[]

  if (!current) {
    throw createError({
      status: 404,
      statusText: 'PagesPage not found'
    })
  }

  // Calculate new path and depth
  let newPath: string
  let newDepth: number

  if (newParentId) {
    const [parent] = await (db as any)
      .select()
      .from(tables.pagesPages)
      .where(
        and(
          eq(tables.pagesPages.id, newParentId),
          eq(tables.pagesPages.teamId, teamId)
        )
      ) as TreeItem[]

    if (!parent) {
      throw createError({
        status: 400,
        statusText: 'Parent PagesPage not found'
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
    .update(tables.pagesPages)
    .set({
      parentId: newParentId,
      path: newPath,
      depth: newDepth,
      order: newOrder
    })
    .where(
      and(
        eq(tables.pagesPages.id, id),
        eq(tables.pagesPages.teamId, teamId)
      )
    )
    .returning()

  // Update all descendants' paths if the path changed
  if (oldPath !== newPath) {
    // Get all descendants
    const descendants = await (db as any)
      .select()
      .from(tables.pagesPages)
      .where(
        and(
          eq(tables.pagesPages.teamId, teamId),
          sql`${tables.pagesPages.path} LIKE ${oldPath + '%'} AND ${tables.pagesPages.id} != ${id}`
        )
      ) as TreeItem[]

    // Update each descendant's path and depth
    for (const descendant of descendants) {
      const descendantNewPath = descendant.path.replace(oldPath, newPath)
      const depthDiff = newDepth - current.depth

      await (db as any)
        .update(tables.pagesPages)
        .set({
          path: descendantNewPath,
          depth: descendant.depth + depthDiff
        })
        .where(eq(tables.pagesPages.id, descendant.id))
    }
  }

  return updated
}

export async function reorderSiblingsPagesPages(
  teamId: string,
  updates: { id: string; order: number }[]
) {
  const db = useDB()

  const results = []

  for (const update of updates) {
    const [updated] = await (db as any)
      .update(tables.pagesPages)
      .set({ order: update.order })
      .where(
        and(
          eq(tables.pagesPages.id, update.id),
          eq(tables.pagesPages.teamId, teamId)
        )
      )
      .returning()

    if (updated) {
      results.push(updated)
    }
  }

  return results
}