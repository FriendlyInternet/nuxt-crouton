// Generated with JSON field post-processing support (v2025-01-11)
import { eq, and, desc, inArray, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/sqlite-core'
import * as tables from './schema'
import type { MainGallery, NewMainGallery } from '../../types'
import * as assetsSchema from '@fyit/crouton-assets/collections/assets/server/database/schema'
import { user } from '~~/server/db/schema'

// Overload order matters: the paginated signature (required `limit`) must come
// first so non-paginated calls fall through to the array overload.
export async function getAllMainGalleries(teamId: string, opts: { imageId?: string; owner?: string; createdBy?: string; updatedBy?: string; limit: number; offset?: number }): Promise<{ items: any[]; total: number }>
export async function getAllMainGalleries(teamId: string, opts?: { imageId?: string; owner?: string; createdBy?: string; updatedBy?: string }): Promise<any[]>
export async function getAllMainGalleries(teamId: string, opts: { imageId?: string; owner?: string; createdBy?: string; updatedBy?: string; limit?: number; offset?: number } = {}) {
  const db = useDB()

  const ownerUser = alias(user as any, 'ownerUser')
  const createdByUser = alias(user as any, 'createdByUser')
  const updatedByUser = alias(user as any, 'updatedByUser')
  const conditions = [eq(tables.mainGalleries.teamId, teamId)]
  if (opts.imageId) conditions.push(eq(tables.mainGalleries.imageId, opts.imageId))
  if (opts.owner) conditions.push(eq(tables.mainGalleries.owner, opts.owner))
  if (opts.createdBy) conditions.push(eq(tables.mainGalleries.createdBy, opts.createdBy))
  if (opts.updatedBy) conditions.push(eq(tables.mainGalleries.updatedBy, opts.updatedBy))
  const whereExpr = and(...conditions)

  let listQuery = (db as any)
    .select({
      ...tables.mainGalleries,
      imageIdData: assetsSchema.croutonAssets,
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
    .from(tables.mainGalleries)
    .leftJoin(assetsSchema.croutonAssets, eq(tables.mainGalleries.imageId, assetsSchema.croutonAssets.id))
    .leftJoin(ownerUser, eq(tables.mainGalleries.owner, ownerUser.id))
    .leftJoin(createdByUser, eq(tables.mainGalleries.createdBy, createdByUser.id))
    .leftJoin(updatedByUser, eq(tables.mainGalleries.updatedBy, updatedByUser.id))
    .where(whereExpr)
    .orderBy(desc(tables.mainGalleries.createdAt))

  if (opts.limit != null) {
    listQuery = listQuery.limit(opts.limit).offset(opts.offset ?? 0)
  }

  const galleries = await listQuery

  if (opts.limit != null) {
    const [countRow] = await (db as any)
      .select({ count: sql`count(*)` })
      .from(tables.mainGalleries)
      .where(whereExpr)
    return { items: galleries, total: Number(countRow?.count ?? 0) }
  }

  return galleries
}

export async function getMainGalleriesByIds(teamId: string, galleryIds: string[]) {
  const db = useDB()

  const ownerUser = alias(user as any, 'ownerUser')
  const createdByUser = alias(user as any, 'createdByUser')
  const updatedByUser = alias(user as any, 'updatedByUser')

  const galleries = await (db as any)
    .select({
      ...tables.mainGalleries,
      imageIdData: assetsSchema.croutonAssets,
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
    .from(tables.mainGalleries)
    .leftJoin(assetsSchema.croutonAssets, eq(tables.mainGalleries.imageId, assetsSchema.croutonAssets.id))
    .leftJoin(ownerUser, eq(tables.mainGalleries.owner, ownerUser.id))
    .leftJoin(createdByUser, eq(tables.mainGalleries.createdBy, createdByUser.id))
    .leftJoin(updatedByUser, eq(tables.mainGalleries.updatedBy, updatedByUser.id))
    .where(
      and(
        eq(tables.mainGalleries.teamId, teamId),
        inArray(tables.mainGalleries.id, galleryIds)
      )
    )
    .orderBy(desc(tables.mainGalleries.createdAt))

  return galleries
}

export async function createMainGallery(data: NewMainGallery) {
  const db = useDB()

  const [gallery] = await (db as any)
    .insert(tables.mainGalleries)
    .values(data)
    .returning()

  return gallery
}

export async function updateMainGallery(
  recordId: string,
  teamId: string,
  userId: string,
  updates: Partial<MainGallery>,
  options?: { role?: string }
) {
  const db = useDB()
  const isAdmin = options?.role === 'admin' || options?.role === 'owner'

  const conditions = [
    eq(tables.mainGalleries.id, recordId),
    eq(tables.mainGalleries.teamId, teamId),
  ]
  if (!isAdmin) {
    conditions.push(eq(tables.mainGalleries.owner, userId))
  }

  const [gallery] = await (db as any)
    .update(tables.mainGalleries)
    .set({
      ...updates,
      updatedBy: userId
    })
    .where(and(...conditions))
    .returning()

  if (!gallery) {
    throw createError({
      status: 404,
      statusText: 'MainGallery not found or unauthorized'
    })
  }

  return gallery
}

export async function deleteMainGallery(
  recordId: string,
  teamId: string,
  userId: string,
  options?: { role?: string }
) {
  const db = useDB()
  const isAdmin = options?.role === 'admin' || options?.role === 'owner'

  const conditions = [
    eq(tables.mainGalleries.id, recordId),
    eq(tables.mainGalleries.teamId, teamId),
  ]
  if (!isAdmin) {
    conditions.push(eq(tables.mainGalleries.owner, userId))
  }

  const [deleted] = await (db as any)
    .delete(tables.mainGalleries)
    .where(and(...conditions))
    .returning()

  if (!deleted) {
    throw createError({
      status: 404,
      statusText: 'MainGallery not found or unauthorized'
    })
  }

  return { success: true }
}