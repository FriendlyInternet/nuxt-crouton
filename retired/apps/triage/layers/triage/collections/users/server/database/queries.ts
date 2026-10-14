// Generated with JSON field post-processing support (v2025-01-11)
import { eq, and, desc, inArray } from 'drizzle-orm'
import { alias } from 'drizzle-orm/sqlite-core'
import * as tables from './schema'
import type { TriageUser, NewTriageUser } from '../../types'
import { user } from '~~/server/db/schema'

export async function getAllTriageUsers(teamId: string) {
  const db = useDB()

  const ownerUser = alias(user as any, 'ownerUser')
  const createdByUser = alias(user as any, 'createdByUser')
  const updatedByUser = alias(user as any, 'updatedByUser')

  const users = await (db as any)
    .select({
      ...tables.triageUsers,
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
    .from(tables.triageUsers)
    .leftJoin(ownerUser, eq(tables.triageUsers.owner, ownerUser.id))
    .leftJoin(createdByUser, eq(tables.triageUsers.createdBy, createdByUser.id))
    .leftJoin(updatedByUser, eq(tables.triageUsers.updatedBy, updatedByUser.id))
    .where(eq(tables.triageUsers.teamId, teamId))
    .orderBy(desc(tables.triageUsers.createdAt))

  // Post-query processing for JSON fields (repeater/json types)
  users.forEach((item: any) => {
      // Parse metadata from JSON string
      if (typeof item.metadata === 'string') {
        try {
          item.metadata = JSON.parse(item.metadata)
        } catch (e) {
          console.error('Error parsing metadata:', e)
          item.metadata = null
        }
      }
      if (item.metadata === null || item.metadata === undefined) {
        item.metadata = null
      }
  })

  return users
}

export async function getTriageUsersByIds(teamId: string, userIds: string[]) {
  const db = useDB()

  const ownerUser = alias(user as any, 'ownerUser')
  const createdByUser = alias(user as any, 'createdByUser')
  const updatedByUser = alias(user as any, 'updatedByUser')

  const users = await (db as any)
    .select({
      ...tables.triageUsers,
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
    .from(tables.triageUsers)
    .leftJoin(ownerUser, eq(tables.triageUsers.owner, ownerUser.id))
    .leftJoin(createdByUser, eq(tables.triageUsers.createdBy, createdByUser.id))
    .leftJoin(updatedByUser, eq(tables.triageUsers.updatedBy, updatedByUser.id))
    .where(
      and(
        eq(tables.triageUsers.teamId, teamId),
        inArray(tables.triageUsers.id, userIds)
      )
    )
    .orderBy(desc(tables.triageUsers.createdAt))

  // Post-query processing for JSON fields (repeater/json types)
  users.forEach((item: any) => {
      // Parse metadata from JSON string
      if (typeof item.metadata === 'string') {
        try {
          item.metadata = JSON.parse(item.metadata)
        } catch (e) {
          console.error('Error parsing metadata:', e)
          item.metadata = null
        }
      }
      if (item.metadata === null || item.metadata === undefined) {
        item.metadata = null
      }
  })

  return users
}

export async function createTriageUser(data: NewTriageUser) {
  const db = useDB()

  const [user] = await (db as any)
    .insert(tables.triageUsers)
    .values(data)
    .returning()

  return user
}

export async function updateTriageUser(
  recordId: string,
  teamId: string,
  userId: string,
  updates: Partial<TriageUser>,
  options?: { role?: string }
) {
  const db = useDB()
  const isAdmin = options?.role === 'admin' || options?.role === 'owner'

  const conditions = [
    eq(tables.triageUsers.id, recordId),
    eq(tables.triageUsers.teamId, teamId),
  ]
  if (!isAdmin) {
    conditions.push(eq(tables.triageUsers.owner, userId))
  }

  const [user] = await (db as any)
    .update(tables.triageUsers)
    .set({
      ...updates,
      updatedBy: userId
    })
    .where(and(...conditions))
    .returning()

  if (!user) {
    throw createError({
      status: 404,
      statusText: 'TriageUser not found or unauthorized'
    })
  }

  return user
}

export async function deleteTriageUser(
  recordId: string,
  teamId: string,
  userId: string,
  options?: { role?: string }
) {
  const db = useDB()
  const isAdmin = options?.role === 'admin' || options?.role === 'owner'

  const conditions = [
    eq(tables.triageUsers.id, recordId),
    eq(tables.triageUsers.teamId, teamId),
  ]
  if (!isAdmin) {
    conditions.push(eq(tables.triageUsers.owner, userId))
  }

  const [deleted] = await (db as any)
    .delete(tables.triageUsers)
    .where(and(...conditions))
    .returning()

  if (!deleted) {
    throw createError({
      status: 404,
      statusText: 'TriageUser not found or unauthorized'
    })
  }

  return { success: true }
}