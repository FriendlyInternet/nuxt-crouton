// Generated with JSON field post-processing support (v2025-01-11)
import { eq, and, desc, inArray, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/sqlite-core'
import * as tables from './schema'
import type { SalesOrderitem, NewSalesOrderitem } from '../../types'
import * as ordersSchema from '../../../orders/server/database/schema'
import * as productsSchema from '../../../products/server/database/schema'
import { user } from '~~/server/db/schema'

// Overload order matters: the paginated signature (required `limit`) must come
// first so non-paginated calls fall through to the array overload.
export async function getAllSalesOrderitems(teamId: string, opts: { orderId?: string; productId?: string; limit: number; offset?: number }): Promise<{ items: any[]; total: number }>
export async function getAllSalesOrderitems(teamId: string, opts?: { orderId?: string; productId?: string }): Promise<any[]>
export async function getAllSalesOrderitems(teamId: string, opts: { orderId?: string; productId?: string; limit?: number; offset?: number } = {}) {
  const db = useDB()

  const ownerUser = alias(user as any, 'ownerUser')
  const createdByUser = alias(user as any, 'createdByUser')
  const updatedByUser = alias(user as any, 'updatedByUser')
  const conditions = [eq(tables.salesOrderitems.teamId, teamId)]
  if (opts.orderId) conditions.push(eq(tables.salesOrderitems.orderId, opts.orderId))
  if (opts.productId) conditions.push(eq(tables.salesOrderitems.productId, opts.productId))
  const whereExpr = and(...conditions)

  let listQuery = (db as any)
    .select({
      ...tables.salesOrderitems,
      orderIdData: ordersSchema.salesOrders,
      productIdData: productsSchema.salesProducts,
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
    .from(tables.salesOrderitems)
    .leftJoin(ordersSchema.salesOrders, eq(tables.salesOrderitems.orderId, ordersSchema.salesOrders.id))
    .leftJoin(productsSchema.salesProducts, eq(tables.salesOrderitems.productId, productsSchema.salesProducts.id))
    .leftJoin(ownerUser, eq(tables.salesOrderitems.owner, ownerUser.id))
    .leftJoin(createdByUser, eq(tables.salesOrderitems.createdBy, createdByUser.id))
    .leftJoin(updatedByUser, eq(tables.salesOrderitems.updatedBy, updatedByUser.id))
    .where(whereExpr)
    .orderBy(desc(tables.salesOrderitems.createdAt))

  if (opts.limit != null) {
    listQuery = listQuery.limit(opts.limit).offset(opts.offset ?? 0)
  }

  const orderitems = await listQuery

  // Post-query processing for JSON fields (repeater/json types)
  orderitems.forEach((item: any) => {
      // Parse selectedOptions from JSON string
      if (typeof item.selectedOptions === 'string') {
        try {
          item.selectedOptions = JSON.parse(item.selectedOptions)
        } catch (e) {
          console.error('Error parsing selectedOptions:', e)
          item.selectedOptions = null
        }
      }
      if (item.selectedOptions === null || item.selectedOptions === undefined) {
        item.selectedOptions = null
      }
  })

  if (opts.limit != null) {
    const [countRow] = await (db as any)
      .select({ count: sql`count(*)` })
      .from(tables.salesOrderitems)
      .where(whereExpr)
    return { items: orderitems, total: Number(countRow?.count ?? 0) }
  }

  return orderitems
}

export async function getSalesOrderitemsByIds(teamId: string, orderitemIds: string[]) {
  const db = useDB()

  const ownerUser = alias(user as any, 'ownerUser')
  const createdByUser = alias(user as any, 'createdByUser')
  const updatedByUser = alias(user as any, 'updatedByUser')

  const orderitems = await (db as any)
    .select({
      ...tables.salesOrderitems,
      orderIdData: ordersSchema.salesOrders,
      productIdData: productsSchema.salesProducts,
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
    .from(tables.salesOrderitems)
    .leftJoin(ordersSchema.salesOrders, eq(tables.salesOrderitems.orderId, ordersSchema.salesOrders.id))
    .leftJoin(productsSchema.salesProducts, eq(tables.salesOrderitems.productId, productsSchema.salesProducts.id))
    .leftJoin(ownerUser, eq(tables.salesOrderitems.owner, ownerUser.id))
    .leftJoin(createdByUser, eq(tables.salesOrderitems.createdBy, createdByUser.id))
    .leftJoin(updatedByUser, eq(tables.salesOrderitems.updatedBy, updatedByUser.id))
    .where(
      and(
        eq(tables.salesOrderitems.teamId, teamId),
        inArray(tables.salesOrderitems.id, orderitemIds)
      )
    )
    .orderBy(desc(tables.salesOrderitems.createdAt))

  // Post-query processing for JSON fields (repeater/json types)
  orderitems.forEach((item: any) => {
      // Parse selectedOptions from JSON string
      if (typeof item.selectedOptions === 'string') {
        try {
          item.selectedOptions = JSON.parse(item.selectedOptions)
        } catch (e) {
          console.error('Error parsing selectedOptions:', e)
          item.selectedOptions = null
        }
      }
      if (item.selectedOptions === null || item.selectedOptions === undefined) {
        item.selectedOptions = null
      }
  })

  return orderitems
}

export async function createSalesOrderitem(data: NewSalesOrderitem) {
  const db = useDB()

  const [orderitem] = await (db as any)
    .insert(tables.salesOrderitems)
    .values(data)
    .returning()

  return orderitem
}

export async function updateSalesOrderitem(
  recordId: string,
  teamId: string,
  userId: string,
  updates: Partial<SalesOrderitem>,
  options?: { role?: string }
) {
  const db = useDB()
  const isAdmin = options?.role === 'admin' || options?.role === 'owner'

  const conditions = [
    eq(tables.salesOrderitems.id, recordId),
    eq(tables.salesOrderitems.teamId, teamId),
  ]
  if (!isAdmin) {
    conditions.push(eq(tables.salesOrderitems.owner, userId))
  }

  const [orderitem] = await (db as any)
    .update(tables.salesOrderitems)
    .set({
      ...updates,
      updatedBy: userId
    })
    .where(and(...conditions))
    .returning()

  if (!orderitem) {
    throw createError({
      status: 404,
      statusText: 'SalesOrderitem not found or unauthorized'
    })
  }

  return orderitem
}

export async function deleteSalesOrderitem(
  recordId: string,
  teamId: string,
  userId: string,
  options?: { role?: string }
) {
  const db = useDB()
  const isAdmin = options?.role === 'admin' || options?.role === 'owner'

  const conditions = [
    eq(tables.salesOrderitems.id, recordId),
    eq(tables.salesOrderitems.teamId, teamId),
  ]
  if (!isAdmin) {
    conditions.push(eq(tables.salesOrderitems.owner, userId))
  }

  const [deleted] = await (db as any)
    .delete(tables.salesOrderitems)
    .where(and(...conditions))
    .returning()

  if (!deleted) {
    throw createError({
      status: 404,
      statusText: 'SalesOrderitem not found or unauthorized'
    })
  }

  return { success: true }
}