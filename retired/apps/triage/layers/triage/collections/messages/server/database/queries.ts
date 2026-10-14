// Generated with JSON field post-processing support (v2025-01-11)
import { eq, and, desc, inArray } from 'drizzle-orm'
import { alias } from 'drizzle-orm/sqlite-core'
import * as tables from './schema'
import type { TriageMessage, NewTriageMessage } from '../../types'
import * as inputsSchema from '../../../inputs/server/database/schema'
import { user } from '~~/server/db/schema'

export async function getAllTriageMessages(teamId: string) {
  const db = useDB()

  const ownerUser = alias(user as any, 'ownerUser')
  const createdByUser = alias(user as any, 'createdByUser')
  const updatedByUser = alias(user as any, 'updatedByUser')

  const messages = await (db as any)
    .select({
      ...tables.triageMessages,
      flowInputIdData: inputsSchema.triageInputs,
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
    .from(tables.triageMessages)
    .leftJoin(inputsSchema.triageInputs, eq(tables.triageMessages.flowInputId, inputsSchema.triageInputs.id))
    .leftJoin(ownerUser, eq(tables.triageMessages.owner, ownerUser.id))
    .leftJoin(createdByUser, eq(tables.triageMessages.createdBy, createdByUser.id))
    .leftJoin(updatedByUser, eq(tables.triageMessages.updatedBy, updatedByUser.id))
    .where(eq(tables.triageMessages.teamId, teamId))
    .orderBy(desc(tables.triageMessages.createdAt))

  return messages
}

export async function getTriageMessagesByIds(teamId: string, messageIds: string[]) {
  const db = useDB()

  const ownerUser = alias(user as any, 'ownerUser')
  const createdByUser = alias(user as any, 'createdByUser')
  const updatedByUser = alias(user as any, 'updatedByUser')

  const messages = await (db as any)
    .select({
      ...tables.triageMessages,
      flowInputIdData: inputsSchema.triageInputs,
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
    .from(tables.triageMessages)
    .leftJoin(inputsSchema.triageInputs, eq(tables.triageMessages.flowInputId, inputsSchema.triageInputs.id))
    .leftJoin(ownerUser, eq(tables.triageMessages.owner, ownerUser.id))
    .leftJoin(createdByUser, eq(tables.triageMessages.createdBy, createdByUser.id))
    .leftJoin(updatedByUser, eq(tables.triageMessages.updatedBy, updatedByUser.id))
    .where(
      and(
        eq(tables.triageMessages.teamId, teamId),
        inArray(tables.triageMessages.id, messageIds)
      )
    )
    .orderBy(desc(tables.triageMessages.createdAt))

  return messages
}

export async function createTriageMessage(data: NewTriageMessage) {
  const db = useDB()

  const [message] = await (db as any)
    .insert(tables.triageMessages)
    .values(data)
    .returning()

  return message
}

export async function updateTriageMessage(
  recordId: string,
  teamId: string,
  userId: string,
  updates: Partial<TriageMessage>,
  options?: { role?: string }
) {
  const db = useDB()
  const isAdmin = options?.role === 'admin' || options?.role === 'owner'

  const conditions = [
    eq(tables.triageMessages.id, recordId),
    eq(tables.triageMessages.teamId, teamId),
  ]
  if (!isAdmin) {
    conditions.push(eq(tables.triageMessages.owner, userId))
  }

  const [message] = await (db as any)
    .update(tables.triageMessages)
    .set({
      ...updates,
      updatedBy: userId
    })
    .where(and(...conditions))
    .returning()

  if (!message) {
    throw createError({
      status: 404,
      statusText: 'TriageMessage not found or unauthorized'
    })
  }

  return message
}

export async function deleteTriageMessage(
  recordId: string,
  teamId: string,
  userId: string,
  options?: { role?: string }
) {
  const db = useDB()
  const isAdmin = options?.role === 'admin' || options?.role === 'owner'

  const conditions = [
    eq(tables.triageMessages.id, recordId),
    eq(tables.triageMessages.teamId, teamId),
  ]
  if (!isAdmin) {
    conditions.push(eq(tables.triageMessages.owner, userId))
  }

  const [deleted] = await (db as any)
    .delete(tables.triageMessages)
    .where(and(...conditions))
    .returning()

  if (!deleted) {
    throw createError({
      status: 404,
      statusText: 'TriageMessage not found or unauthorized'
    })
  }

  return { success: true }
}