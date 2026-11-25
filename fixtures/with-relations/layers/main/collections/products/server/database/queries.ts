// Generated with JSON field post-processing support (v2025-01-11)
import { eq, and, desc, inArray, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/sqlite-core'
import * as tables from './schema'
import type { MainProduct, NewMainProduct } from '../../types'
import * as categoriesSchema from '../../../categories/server/database/schema'
import { user } from '~~/server/db/schema'

// Overload order matters: the paginated signature (required `limit`) must come
// first so non-paginated calls fall through to the array overload.
export async function getAllMainProducts(teamId: string, opts: { categoryId?: string; owner?: string; createdBy?: string; updatedBy?: string; limit: number; offset?: number }): Promise<{ items: any[]; total: number }>
export async function getAllMainProducts(teamId: string, opts?: { categoryId?: string; owner?: string; createdBy?: string; updatedBy?: string }): Promise<any[]>
export async function getAllMainProducts(teamId: string, opts: { categoryId?: string; owner?: string; createdBy?: string; updatedBy?: string; limit?: number; offset?: number } = {}) {
  const db = useDB()

  const ownerUser = alias(user as any, 'ownerUser')
  const createdByUser = alias(user as any, 'createdByUser')
  const updatedByUser = alias(user as any, 'updatedByUser')
  const conditions = [eq(tables.mainProducts.teamId, teamId)]
  if (opts.categoryId) conditions.push(eq(tables.mainProducts.categoryId, opts.categoryId))
  if (opts.owner) conditions.push(eq(tables.mainProducts.owner, opts.owner))
  if (opts.createdBy) conditions.push(eq(tables.mainProducts.createdBy, opts.createdBy))
  if (opts.updatedBy) conditions.push(eq(tables.mainProducts.updatedBy, opts.updatedBy))
  const whereExpr = and(...conditions)

  let listQuery = (db as any)
    .select({
      ...tables.mainProducts,
      categoryIdData: categoriesSchema.mainCategories,
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
    .from(tables.mainProducts)
    .leftJoin(categoriesSchema.mainCategories, eq(tables.mainProducts.categoryId, categoriesSchema.mainCategories.id))
    .leftJoin(ownerUser, eq(tables.mainProducts.owner, ownerUser.id))
    .leftJoin(createdByUser, eq(tables.mainProducts.createdBy, createdByUser.id))
    .leftJoin(updatedByUser, eq(tables.mainProducts.updatedBy, updatedByUser.id))
    .where(whereExpr)
    .orderBy(desc(tables.mainProducts.createdAt))

  if (opts.limit != null) {
    listQuery = listQuery.limit(opts.limit).offset(opts.offset ?? 0)
  }

  const products = await listQuery

  if (opts.limit != null) {
    const [countRow] = await (db as any)
      .select({ count: sql`count(*)` })
      .from(tables.mainProducts)
      .where(whereExpr)
    return { items: products, total: Number(countRow?.count ?? 0) }
  }

  return products
}

export async function getMainProductsByIds(teamId: string, productIds: string[]) {
  const db = useDB()

  const ownerUser = alias(user as any, 'ownerUser')
  const createdByUser = alias(user as any, 'createdByUser')
  const updatedByUser = alias(user as any, 'updatedByUser')

  const products = await (db as any)
    .select({
      ...tables.mainProducts,
      categoryIdData: categoriesSchema.mainCategories,
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
    .from(tables.mainProducts)
    .leftJoin(categoriesSchema.mainCategories, eq(tables.mainProducts.categoryId, categoriesSchema.mainCategories.id))
    .leftJoin(ownerUser, eq(tables.mainProducts.owner, ownerUser.id))
    .leftJoin(createdByUser, eq(tables.mainProducts.createdBy, createdByUser.id))
    .leftJoin(updatedByUser, eq(tables.mainProducts.updatedBy, updatedByUser.id))
    .where(
      and(
        eq(tables.mainProducts.teamId, teamId),
        inArray(tables.mainProducts.id, productIds)
      )
    )
    .orderBy(desc(tables.mainProducts.createdAt))

  return products
}

export async function createMainProduct(data: NewMainProduct) {
  const db = useDB()

  const [product] = await (db as any)
    .insert(tables.mainProducts)
    .values(data)
    .returning()

  return product
}

export async function updateMainProduct(
  recordId: string,
  teamId: string,
  userId: string,
  updates: Partial<MainProduct>,
  options?: { seesAll?: boolean }
) {
  const db = useDB()
  const seesAll = options?.seesAll === true

  const conditions = [
    eq(tables.mainProducts.id, recordId),
    eq(tables.mainProducts.teamId, teamId),
  ]
  if (!seesAll) {
    conditions.push(eq(tables.mainProducts.owner, userId))
  }

  const [product] = await (db as any)
    .update(tables.mainProducts)
    .set({
      ...updates,
      updatedBy: userId
    })
    .where(and(...conditions))
    .returning()

  if (!product) {
    throw createError({
      status: 404,
      statusText: 'MainProduct not found or unauthorized'
    })
  }

  return product
}

export async function deleteMainProduct(
  recordId: string,
  teamId: string,
  userId: string,
  options?: { seesAll?: boolean }
) {
  const db = useDB()
  const seesAll = options?.seesAll === true

  const conditions = [
    eq(tables.mainProducts.id, recordId),
    eq(tables.mainProducts.teamId, teamId),
  ]
  if (!seesAll) {
    conditions.push(eq(tables.mainProducts.owner, userId))
  }

  const [deleted] = await (db as any)
    .delete(tables.mainProducts)
    .where(and(...conditions))
    .returning()

  if (!deleted) {
    throw createError({
      status: 404,
      statusText: 'MainProduct not found or unauthorized'
    })
  }

  return { success: true }
}

export async function assertMainProductReferences(teamId: string, data: Record<string, any>) {
  await assertRefsInTeam(useDB(), teamId, [
    { field: 'categoryId', table: categoriesSchema.mainCategories, value: data.categoryId },
  ])
}