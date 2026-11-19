// Team-scoped queries for catalog products. Every read and write carries a
// `teamId` condition, so no request can see or touch another team's product.
import { eq, and, desc, inArray } from 'drizzle-orm'
import { alias } from 'drizzle-orm/sqlite-core'
import * as tables from './schema'
import type { CatalogProduct, NewCatalogProduct } from '../../types'
import { user } from '~~/server/db/schema'

function selectWithUsers() {
  const db = useDB()

  const ownerUser = alias(user as any, 'ownerUser')
  const createdByUser = alias(user as any, 'createdByUser')
  const updatedByUser = alias(user as any, 'updatedByUser')

  return (db as any)
    .select({
      ...tables.catalogProducts,
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
    .from(tables.catalogProducts)
    .leftJoin(ownerUser, eq(tables.catalogProducts.owner, ownerUser.id))
    .leftJoin(createdByUser, eq(tables.catalogProducts.createdBy, createdByUser.id))
    .leftJoin(updatedByUser, eq(tables.catalogProducts.updatedBy, updatedByUser.id))
}

export async function getAllCatalogProducts(teamId: string) {
  return await selectWithUsers()
    .where(eq(tables.catalogProducts.teamId, teamId))
    .orderBy(desc(tables.catalogProducts.createdAt))
}

export async function getCatalogProductsByIds(teamId: string, productIds: string[]) {
  return await selectWithUsers()
    .where(
      and(
        eq(tables.catalogProducts.teamId, teamId),
        inArray(tables.catalogProducts.id, productIds)
      )
    )
    .orderBy(desc(tables.catalogProducts.createdAt))
}

export async function createCatalogProduct(data: NewCatalogProduct) {
  const db = useDB()

  const [product] = await (db as any)
    .insert(tables.catalogProducts)
    .values(data)
    .returning()

  return product
}

export async function updateCatalogProduct(
  recordId: string,
  teamId: string,
  userId: string,
  updates: Partial<CatalogProduct>,
  options?: { role?: string }
) {
  const db = useDB()
  const isAdmin = options?.role === 'admin' || options?.role === 'owner'

  const conditions = [
    eq(tables.catalogProducts.id, recordId),
    eq(tables.catalogProducts.teamId, teamId),
  ]
  if (!isAdmin) {
    conditions.push(eq(tables.catalogProducts.owner, userId))
  }

  const [product] = await (db as any)
    .update(tables.catalogProducts)
    .set({
      ...updates,
      updatedBy: userId
    })
    .where(and(...conditions))
    .returning()

  if (!product) {
    throw createError({
      status: 404,
      statusText: 'CatalogProduct not found or unauthorized'
    })
  }

  return product
}

export async function deleteCatalogProduct(
  recordId: string,
  teamId: string,
  userId: string,
  options?: { role?: string }
) {
  const db = useDB()
  const isAdmin = options?.role === 'admin' || options?.role === 'owner'

  const conditions = [
    eq(tables.catalogProducts.id, recordId),
    eq(tables.catalogProducts.teamId, teamId),
  ]
  if (!isAdmin) {
    conditions.push(eq(tables.catalogProducts.owner, userId))
  }

  const [deleted] = await (db as any)
    .delete(tables.catalogProducts)
    .where(and(...conditions))
    .returning()

  if (!deleted) {
    throw createError({
      status: 404,
      statusText: 'CatalogProduct not found or unauthorized'
    })
  }

  return { success: true }
}
