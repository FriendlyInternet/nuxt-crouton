// Generated with JSON field post-processing support (v2025-01-11)
import { eq, and, desc, inArray } from 'drizzle-orm'
import { alias } from 'drizzle-orm/sqlite-core'
import * as tables from './schema'
import type { CroutonAsset, NewCroutonAsset } from '../../types'
import { user } from '~~/server/db/schema'

export async function getAllCroutonAssets(teamId: string) {
  const db = useDB()

  const ownerUser = alias(user as any, 'ownerUser')
  const createdByUser = alias(user as any, 'createdByUser')
  const updatedByUser = alias(user as any, 'updatedByUser')

  const assets = await (db as any)
    .select({
      ...tables.croutonAssets,
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
    .from(tables.croutonAssets)
    .leftJoin(ownerUser, eq(tables.croutonAssets.owner, ownerUser.id))
    .leftJoin(createdByUser, eq(tables.croutonAssets.createdBy, createdByUser.id))
    .leftJoin(updatedByUser, eq(tables.croutonAssets.updatedBy, updatedByUser.id))
    .where(eq(tables.croutonAssets.teamId, teamId))
    .orderBy(desc(tables.croutonAssets.createdAt))

  return assets
}

export async function getCroutonAssetsByIds(teamId: string, assetIds: string[]) {
  const db = useDB()

  const ownerUser = alias(user as any, 'ownerUser')
  const createdByUser = alias(user as any, 'createdByUser')
  const updatedByUser = alias(user as any, 'updatedByUser')

  const assets = await (db as any)
    .select({
      ...tables.croutonAssets,
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
    .from(tables.croutonAssets)
    .leftJoin(ownerUser, eq(tables.croutonAssets.owner, ownerUser.id))
    .leftJoin(createdByUser, eq(tables.croutonAssets.createdBy, createdByUser.id))
    .leftJoin(updatedByUser, eq(tables.croutonAssets.updatedBy, updatedByUser.id))
    .where(
      and(
        eq(tables.croutonAssets.teamId, teamId),
        inArray(tables.croutonAssets.id, assetIds)
      )
    )
    .orderBy(desc(tables.croutonAssets.createdAt))

  return assets
}

export async function createCroutonAsset(data: NewCroutonAsset) {
  const db = useDB()

  const [asset] = await (db as any)
    .insert(tables.croutonAssets)
    .values(data)
    .returning()

  return asset
}

export async function updateCroutonAsset(
  recordId: string,
  teamId: string,
  userId: string,
  updates: Partial<CroutonAsset>,
  options?: { role?: string }
) {
  const db = useDB()
  const isAdmin = options?.role === 'admin' || options?.role === 'owner'

  const conditions = [
    eq(tables.croutonAssets.id, recordId),
    eq(tables.croutonAssets.teamId, teamId),
  ]
  if (!isAdmin) {
    conditions.push(eq(tables.croutonAssets.owner, userId))
  }

  const [asset] = await (db as any)
    .update(tables.croutonAssets)
    .set({
      ...updates,
      updatedBy: userId
    })
    .where(and(...conditions))
    .returning()

  if (!asset) {
    throw createError({
      status: 404,
      statusText: 'CroutonAsset not found or unauthorized'
    })
  }

  return asset
}

export async function deleteCroutonAsset(
  recordId: string,
  teamId: string,
  userId: string,
  options?: { role?: string }
) {
  const db = useDB()
  const isAdmin = options?.role === 'admin' || options?.role === 'owner'

  const conditions = [
    eq(tables.croutonAssets.id, recordId),
    eq(tables.croutonAssets.teamId, teamId),
  ]
  if (!isAdmin) {
    conditions.push(eq(tables.croutonAssets.owner, userId))
  }

  const [deleted] = await (db as any)
    .delete(tables.croutonAssets)
    .where(and(...conditions))
    .returning()

  if (!deleted) {
    throw createError({
      status: 404,
      statusText: 'CroutonAsset not found or unauthorized'
    })
  }

  return { success: true }
}