// Generated with JSON field post-processing support (v2025-01-11)
import { eq, and, desc, inArray } from 'drizzle-orm'
import { alias } from 'drizzle-orm/sqlite-core'
import * as tables from './schema'
import type { TriageAccount, NewTriageAccount } from '../../types'
import { user } from '~~/server/db/schema'

export async function getAllTriageAccounts(teamId: string) {
  const db = useDB()

  const ownerUser = alias(user as any, 'ownerUser')
  const createdByUser = alias(user as any, 'createdByUser')
  const updatedByUser = alias(user as any, 'updatedByUser')

  const accounts = await (db as any)
    .select({
      ...tables.triageAccounts,
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
    .from(tables.triageAccounts)
    .leftJoin(ownerUser, eq(tables.triageAccounts.owner, ownerUser.id))
    .leftJoin(createdByUser, eq(tables.triageAccounts.createdBy, createdByUser.id))
    .leftJoin(updatedByUser, eq(tables.triageAccounts.updatedBy, updatedByUser.id))
    .where(eq(tables.triageAccounts.teamId, teamId))
    .orderBy(desc(tables.triageAccounts.createdAt))

  // Post-query processing for JSON fields (repeater/json types)
  accounts.forEach((item: any) => {
      // Parse providerMetadata from JSON string
      if (typeof item.providerMetadata === 'string') {
        try {
          item.providerMetadata = JSON.parse(item.providerMetadata)
        } catch (e) {
          console.error('Error parsing providerMetadata:', e)
          item.providerMetadata = null
        }
      }
      if (item.providerMetadata === null || item.providerMetadata === undefined) {
        item.providerMetadata = null
      }
  })

  return accounts
}

export async function getTriageAccountsByIds(teamId: string, accountIds: string[]) {
  const db = useDB()

  const ownerUser = alias(user as any, 'ownerUser')
  const createdByUser = alias(user as any, 'createdByUser')
  const updatedByUser = alias(user as any, 'updatedByUser')

  const accounts = await (db as any)
    .select({
      ...tables.triageAccounts,
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
    .from(tables.triageAccounts)
    .leftJoin(ownerUser, eq(tables.triageAccounts.owner, ownerUser.id))
    .leftJoin(createdByUser, eq(tables.triageAccounts.createdBy, createdByUser.id))
    .leftJoin(updatedByUser, eq(tables.triageAccounts.updatedBy, updatedByUser.id))
    .where(
      and(
        eq(tables.triageAccounts.teamId, teamId),
        inArray(tables.triageAccounts.id, accountIds)
      )
    )
    .orderBy(desc(tables.triageAccounts.createdAt))

  // Post-query processing for JSON fields (repeater/json types)
  accounts.forEach((item: any) => {
      // Parse providerMetadata from JSON string
      if (typeof item.providerMetadata === 'string') {
        try {
          item.providerMetadata = JSON.parse(item.providerMetadata)
        } catch (e) {
          console.error('Error parsing providerMetadata:', e)
          item.providerMetadata = null
        }
      }
      if (item.providerMetadata === null || item.providerMetadata === undefined) {
        item.providerMetadata = null
      }
  })

  return accounts
}

export async function createTriageAccount(data: NewTriageAccount) {
  const db = useDB()

  const [account] = await (db as any)
    .insert(tables.triageAccounts)
    .values(data)
    .returning()

  return account
}

export async function updateTriageAccount(
  recordId: string,
  teamId: string,
  ownerId: string,
  updates: Partial<TriageAccount>
) {
  const db = useDB()

  const [account] = await (db as any)
    .update(tables.triageAccounts)
    .set({
      ...updates,
      updatedBy: ownerId
    })
    .where(
      and(
        eq(tables.triageAccounts.id, recordId),
        eq(tables.triageAccounts.teamId, teamId),
        eq(tables.triageAccounts.owner, ownerId)
      )
    )
    .returning()

  if (!account) {
    throw createError({
      status: 404,
      statusText: 'TriageAccount not found or unauthorized'
    })
  }

  return account
}

export async function deleteTriageAccount(
  recordId: string,
  teamId: string,
  ownerId: string
) {
  const db = useDB()

  const [deleted] = await (db as any)
    .delete(tables.triageAccounts)
    .where(
      and(
        eq(tables.triageAccounts.id, recordId),
        eq(tables.triageAccounts.teamId, teamId),
        eq(tables.triageAccounts.owner, ownerId)
      )
    )
    .returning()

  if (!deleted) {
    throw createError({
      status: 404,
      statusText: 'TriageAccount not found or unauthorized'
    })
  }

  return { success: true }
}