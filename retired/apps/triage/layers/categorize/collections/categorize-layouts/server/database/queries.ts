// Generated with JSON field post-processing support (v2025-01-11)
import { eq, and, desc, inArray } from 'drizzle-orm'
import { alias } from 'drizzle-orm/sqlite-core'
import * as tables from './schema'
import type { CategorizeCategorizeLayout, NewCategorizeCategorizeLayout } from '../../types'
import { user } from '~~/server/db/schema'

export async function getAllCategorizeCategorizeLayouts(teamId: string) {
  const db = useDB()

  const ownerUser = alias(user as any, 'ownerUser')
  const createdByUser = alias(user as any, 'createdByUser')
  const updatedByUser = alias(user as any, 'updatedByUser')

  const categorizeLayouts = await (db as any)
    .select({
      ...tables.categorizeCategorizeLayouts,
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
    .from(tables.categorizeCategorizeLayouts)
    .leftJoin(ownerUser, eq(tables.categorizeCategorizeLayouts.owner, ownerUser.id))
    .leftJoin(createdByUser, eq(tables.categorizeCategorizeLayouts.createdBy, createdByUser.id))
    .leftJoin(updatedByUser, eq(tables.categorizeCategorizeLayouts.updatedBy, updatedByUser.id))
    .where(eq(tables.categorizeCategorizeLayouts.teamId, teamId))
    .orderBy(desc(tables.categorizeCategorizeLayouts.createdAt))

  // Post-query processing for JSON fields (repeater/json types)
  categorizeLayouts.forEach((item: any) => {
      // Parse layout from JSON string
      if (typeof item.layout === 'string') {
        try {
          item.layout = JSON.parse(item.layout)
        } catch (e) {
          console.error('Error parsing layout:', e)
          item.layout = null
        }
      }
      if (item.layout === null || item.layout === undefined) {
        item.layout = null
      }
  })

  return categorizeLayouts
}

export async function getCategorizeCategorizeLayoutByFilter(teamId: string, databaseId: string, accountId: string) {
  const db = useDB()

  const results = await (db as any)
    .select()
    .from(tables.categorizeCategorizeLayouts)
    .where(
      and(
        eq(tables.categorizeCategorizeLayouts.teamId, teamId),
        eq(tables.categorizeCategorizeLayouts.databaseId, databaseId),
        eq(tables.categorizeCategorizeLayouts.accountId, accountId)
      )
    )
    .orderBy(desc(tables.categorizeCategorizeLayouts.updatedAt))
    .limit(1)

  const item = results[0]
  if (!item) return null

  // Parse layout from JSON string
  if (typeof item.layout === 'string') {
    try {
      item.layout = JSON.parse(item.layout)
    } catch (e) {
      console.error('Error parsing layout:', e)
      item.layout = null
    }
  }

  return item
}

export async function getCategorizeCategorizeLayoutsByIds(teamId: string, categorizeLayoutIds: string[]) {
  const db = useDB()

  const ownerUser = alias(user as any, 'ownerUser')
  const createdByUser = alias(user as any, 'createdByUser')
  const updatedByUser = alias(user as any, 'updatedByUser')

  const categorizeLayouts = await (db as any)
    .select({
      ...tables.categorizeCategorizeLayouts,
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
    .from(tables.categorizeCategorizeLayouts)
    .leftJoin(ownerUser, eq(tables.categorizeCategorizeLayouts.owner, ownerUser.id))
    .leftJoin(createdByUser, eq(tables.categorizeCategorizeLayouts.createdBy, createdByUser.id))
    .leftJoin(updatedByUser, eq(tables.categorizeCategorizeLayouts.updatedBy, updatedByUser.id))
    .where(
      and(
        eq(tables.categorizeCategorizeLayouts.teamId, teamId),
        inArray(tables.categorizeCategorizeLayouts.id, categorizeLayoutIds)
      )
    )
    .orderBy(desc(tables.categorizeCategorizeLayouts.createdAt))

  // Post-query processing for JSON fields (repeater/json types)
  categorizeLayouts.forEach((item: any) => {
      // Parse layout from JSON string
      if (typeof item.layout === 'string') {
        try {
          item.layout = JSON.parse(item.layout)
        } catch (e) {
          console.error('Error parsing layout:', e)
          item.layout = null
        }
      }
      if (item.layout === null || item.layout === undefined) {
        item.layout = null
      }
  })

  return categorizeLayouts
}

export async function createCategorizeCategorizeLayout(data: NewCategorizeCategorizeLayout) {
  const db = useDB()

  const [categorizeLayout] = await (db as any)
    .insert(tables.categorizeCategorizeLayouts)
    .values(data)
    .returning()

  return categorizeLayout
}

export async function updateCategorizeCategorizeLayout(
  recordId: string,
  teamId: string,
  userId: string,
  updates: Partial<CategorizeCategorizeLayout>,
  options?: { role?: string }
) {
  const db = useDB()
  const isAdmin = options?.role === 'admin' || options?.role === 'owner'

  const conditions = [
    eq(tables.categorizeCategorizeLayouts.id, recordId),
    eq(tables.categorizeCategorizeLayouts.teamId, teamId),
  ]
  if (!isAdmin) {
    conditions.push(eq(tables.categorizeCategorizeLayouts.owner, userId))
  }

  const [categorizeLayout] = await (db as any)
    .update(tables.categorizeCategorizeLayouts)
    .set({
      ...updates,
      updatedBy: userId
    })
    .where(and(...conditions))
    .returning()

  if (!categorizeLayout) {
    throw createError({
      status: 404,
      statusText: 'CategorizeCategorizeLayout not found or unauthorized'
    })
  }

  return categorizeLayout
}

export async function deleteCategorizeCategorizeLayout(
  recordId: string,
  teamId: string,
  userId: string,
  options?: { role?: string }
) {
  const db = useDB()
  const isAdmin = options?.role === 'admin' || options?.role === 'owner'

  const conditions = [
    eq(tables.categorizeCategorizeLayouts.id, recordId),
    eq(tables.categorizeCategorizeLayouts.teamId, teamId),
  ]
  if (!isAdmin) {
    conditions.push(eq(tables.categorizeCategorizeLayouts.owner, userId))
  }

  const [deleted] = await (db as any)
    .delete(tables.categorizeCategorizeLayouts)
    .where(and(...conditions))
    .returning()

  if (!deleted) {
    throw createError({
      status: 404,
      statusText: 'CategorizeCategorizeLayout not found or unauthorized'
    })
  }

  return { success: true }
}