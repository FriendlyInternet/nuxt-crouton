// Generated with JSON field post-processing support (v2025-01-11)
import { eq, and, desc, asc, inArray, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/sqlite-core'
import * as tables from './schema'
import type { SalesProduct, NewSalesProduct } from '../../types'
import * as eventsSchema from '../../../events/server/database/schema'
import * as categoriesSchema from '../../../categories/server/database/schema'
import * as locationsSchema from '../../../locations/server/database/schema'
import { user } from '~~/server/db/schema'

// Overload order matters: the paginated signature (required `limit`) must come
// first so non-paginated calls fall through to the array overload.
export async function getAllSalesProducts(teamId: string, opts: { eventId?: string; categoryId?: string; locationId?: string; limit: number; offset?: number }): Promise<{ items: any[]; total: number }>
export async function getAllSalesProducts(teamId: string, opts?: { eventId?: string; categoryId?: string; locationId?: string }): Promise<any[]>
export async function getAllSalesProducts(teamId: string, opts: { eventId?: string; categoryId?: string; locationId?: string; limit?: number; offset?: number } = {}) {
  const db = useDB()

  const ownerUser = alias(user as any, 'ownerUser')
  const createdByUser = alias(user as any, 'createdByUser')
  const updatedByUser = alias(user as any, 'updatedByUser')
  const conditions = [eq(tables.salesProducts.teamId, teamId)]
  if (opts.eventId) conditions.push(eq(tables.salesProducts.eventId, opts.eventId))
  if (opts.categoryId) conditions.push(eq(tables.salesProducts.categoryId, opts.categoryId))
  if (opts.locationId) conditions.push(eq(tables.salesProducts.locationId, opts.locationId))
  const whereExpr = and(...conditions)

  let listQuery = (db as any)
    .select({
      ...tables.salesProducts,
      eventIdData: eventsSchema.salesEvents,
      categoryIdData: categoriesSchema.salesCategories,
      locationIdData: locationsSchema.salesLocations,
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
    .from(tables.salesProducts)
    .leftJoin(eventsSchema.salesEvents, eq(tables.salesProducts.eventId, eventsSchema.salesEvents.id))
    .leftJoin(categoriesSchema.salesCategories, eq(tables.salesProducts.categoryId, categoriesSchema.salesCategories.id))
    .leftJoin(locationsSchema.salesLocations, eq(tables.salesProducts.locationId, locationsSchema.salesLocations.id))
    .leftJoin(ownerUser, eq(tables.salesProducts.owner, ownerUser.id))
    .leftJoin(createdByUser, eq(tables.salesProducts.createdBy, createdByUser.id))
    .leftJoin(updatedByUser, eq(tables.salesProducts.updatedBy, updatedByUser.id))
    .where(whereExpr)
    .orderBy(asc(tables.salesProducts.order), desc(tables.salesProducts.createdAt))

  if (opts.limit != null) {
    listQuery = listQuery.limit(opts.limit).offset(opts.offset ?? 0)
  }

  const products = await listQuery

  // Post-query processing for JSON fields (repeater/json types)
  products.forEach((item: any) => {
      // Parse options from JSON string
      if (typeof item.options === 'string') {
        try {
          item.options = JSON.parse(item.options)
        } catch (e) {
          console.error('Error parsing options:', e)
          item.options = []
        }
      }
      if (item.options === null || item.options === undefined) {
        item.options = []
      }
  })

  if (opts.limit != null) {
    const [countRow] = await (db as any)
      .select({ count: sql`count(*)` })
      .from(tables.salesProducts)
      .where(whereExpr)
    return { items: products, total: Number(countRow?.count ?? 0) }
  }

  return products
}

export async function getSalesProductsByIds(teamId: string, productIds: string[]) {
  const db = useDB()

  const ownerUser = alias(user as any, 'ownerUser')
  const createdByUser = alias(user as any, 'createdByUser')
  const updatedByUser = alias(user as any, 'updatedByUser')

  const products = await (db as any)
    .select({
      ...tables.salesProducts,
      eventIdData: eventsSchema.salesEvents,
      categoryIdData: categoriesSchema.salesCategories,
      locationIdData: locationsSchema.salesLocations,
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
    .from(tables.salesProducts)
    .leftJoin(eventsSchema.salesEvents, eq(tables.salesProducts.eventId, eventsSchema.salesEvents.id))
    .leftJoin(categoriesSchema.salesCategories, eq(tables.salesProducts.categoryId, categoriesSchema.salesCategories.id))
    .leftJoin(locationsSchema.salesLocations, eq(tables.salesProducts.locationId, locationsSchema.salesLocations.id))
    .leftJoin(ownerUser, eq(tables.salesProducts.owner, ownerUser.id))
    .leftJoin(createdByUser, eq(tables.salesProducts.createdBy, createdByUser.id))
    .leftJoin(updatedByUser, eq(tables.salesProducts.updatedBy, updatedByUser.id))
    .where(
      and(
        eq(tables.salesProducts.teamId, teamId),
        inArray(tables.salesProducts.id, productIds)
      )
    )
    .orderBy(asc(tables.salesProducts.order), desc(tables.salesProducts.createdAt))

  // Post-query processing for JSON fields (repeater/json types)
  products.forEach((item: any) => {
      // Parse options from JSON string
      if (typeof item.options === 'string') {
        try {
          item.options = JSON.parse(item.options)
        } catch (e) {
          console.error('Error parsing options:', e)
          item.options = []
        }
      }
      if (item.options === null || item.options === undefined) {
        item.options = []
      }
  })

  return products
}

export async function createSalesProduct(data: NewSalesProduct) {
  const db = useDB()

  const [product] = await (db as any)
    .insert(tables.salesProducts)
    .values(data)
    .returning()

  return product
}

export async function updateSalesProduct(
  recordId: string,
  teamId: string,
  userId: string,
  updates: Partial<SalesProduct>,
  options?: { role?: string }
) {
  const db = useDB()
  const isAdmin = options?.role === 'admin' || options?.role === 'owner'

  const conditions = [
    eq(tables.salesProducts.id, recordId),
    eq(tables.salesProducts.teamId, teamId),
  ]
  if (!isAdmin) {
    conditions.push(eq(tables.salesProducts.owner, userId))
  }

  const [product] = await (db as any)
    .update(tables.salesProducts)
    .set({
      ...updates,
      updatedBy: userId
    })
    .where(and(...conditions))
    .returning()

  if (!product) {
    throw createError({
      status: 404,
      statusText: 'SalesProduct not found or unauthorized'
    })
  }

  return product
}

export async function deleteSalesProduct(
  recordId: string,
  teamId: string,
  userId: string,
  options?: { role?: string }
) {
  const db = useDB()
  const isAdmin = options?.role === 'admin' || options?.role === 'owner'

  const conditions = [
    eq(tables.salesProducts.id, recordId),
    eq(tables.salesProducts.teamId, teamId),
  ]
  if (!isAdmin) {
    conditions.push(eq(tables.salesProducts.owner, userId))
  }

  const [deleted] = await (db as any)
    .delete(tables.salesProducts)
    .where(and(...conditions))
    .returning()

  if (!deleted) {
    throw createError({
      status: 404,
      statusText: 'SalesProduct not found or unauthorized'
    })
  }

  return { success: true }
}

// Sortable reorder queries (auto-generated when sortable: true)

export async function reorderSiblingsSalesProducts(
  teamId: string,
  updates: { id: string; order: number }[]
) {
  const db = useDB()

  const results = await Promise.all(
    updates.map(({ id, order }) =>
      (db as any)
        .update(tables.salesProducts)
        .set({ order })
        .where(
          and(
            eq(tables.salesProducts.id, id),
            eq(tables.salesProducts.teamId, teamId)
          )
        )
        .returning()
    )
  )

  return { success: true, updated: results.flat().length }
}