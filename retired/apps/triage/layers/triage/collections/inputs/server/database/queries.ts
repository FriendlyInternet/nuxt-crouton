// Generated with JSON field post-processing support (v2025-01-11)
import { eq, and, desc, inArray } from 'drizzle-orm'
import { alias } from 'drizzle-orm/sqlite-core'
import * as tables from './schema'
import type { TriageInput, NewTriageInput } from '../../types'
import * as flowsSchema from '../../../flows/server/database/schema'
import { user } from '~~/server/db/schema'

export async function getAllTriageInputs(teamId: string) {
  const db = useDB()

  const ownerUser = alias(user as any, 'ownerUser')
  const createdByUser = alias(user as any, 'createdByUser')
  const updatedByUser = alias(user as any, 'updatedByUser')

  const inputs = await (db as any)
    .select({
      ...tables.triageInputs,
      flowIdData: flowsSchema.triageFlows,
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
    .from(tables.triageInputs)
    .leftJoin(flowsSchema.triageFlows, eq(tables.triageInputs.flowId, flowsSchema.triageFlows.id))
    .leftJoin(ownerUser, eq(tables.triageInputs.owner, ownerUser.id))
    .leftJoin(createdByUser, eq(tables.triageInputs.createdBy, createdByUser.id))
    .leftJoin(updatedByUser, eq(tables.triageInputs.updatedBy, updatedByUser.id))
    .where(eq(tables.triageInputs.teamId, teamId))
    .orderBy(desc(tables.triageInputs.createdAt))

  // Post-query processing for JSON fields (repeater/json types)
  inputs.forEach((item: any) => {
      // Parse sourceMetadata from JSON string
      if (typeof item.sourceMetadata === 'string') {
        try {
          item.sourceMetadata = JSON.parse(item.sourceMetadata)
        } catch (e) {
          console.error('Error parsing sourceMetadata:', e)
          item.sourceMetadata = null
        }
      }
      if (item.sourceMetadata === null || item.sourceMetadata === undefined) {
        item.sourceMetadata = null
      }
  })

  return inputs
}

export async function getTriageInputsByIds(teamId: string, inputIds: string[]) {
  const db = useDB()

  const ownerUser = alias(user as any, 'ownerUser')
  const createdByUser = alias(user as any, 'createdByUser')
  const updatedByUser = alias(user as any, 'updatedByUser')

  const inputs = await (db as any)
    .select({
      ...tables.triageInputs,
      flowIdData: flowsSchema.triageFlows,
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
    .from(tables.triageInputs)
    .leftJoin(flowsSchema.triageFlows, eq(tables.triageInputs.flowId, flowsSchema.triageFlows.id))
    .leftJoin(ownerUser, eq(tables.triageInputs.owner, ownerUser.id))
    .leftJoin(createdByUser, eq(tables.triageInputs.createdBy, createdByUser.id))
    .leftJoin(updatedByUser, eq(tables.triageInputs.updatedBy, updatedByUser.id))
    .where(
      and(
        eq(tables.triageInputs.teamId, teamId),
        inArray(tables.triageInputs.id, inputIds)
      )
    )
    .orderBy(desc(tables.triageInputs.createdAt))

  // Post-query processing for JSON fields (repeater/json types)
  inputs.forEach((item: any) => {
      // Parse sourceMetadata from JSON string
      if (typeof item.sourceMetadata === 'string') {
        try {
          item.sourceMetadata = JSON.parse(item.sourceMetadata)
        } catch (e) {
          console.error('Error parsing sourceMetadata:', e)
          item.sourceMetadata = null
        }
      }
      if (item.sourceMetadata === null || item.sourceMetadata === undefined) {
        item.sourceMetadata = null
      }
  })

  return inputs
}

export async function createTriageInput(data: NewTriageInput) {
  const db = useDB()

  const [input] = await (db as any)
    .insert(tables.triageInputs)
    .values(data)
    .returning()

  return input
}

export async function updateTriageInput(
  recordId: string,
  teamId: string,
  userId: string,
  updates: Partial<TriageInput>,
  options?: { role?: string }
) {
  const db = useDB()
  const isAdmin = options?.role === 'admin' || options?.role === 'owner'

  const conditions = [
    eq(tables.triageInputs.id, recordId),
    eq(tables.triageInputs.teamId, teamId),
  ]
  if (!isAdmin) {
    conditions.push(eq(tables.triageInputs.owner, userId))
  }

  const [input] = await (db as any)
    .update(tables.triageInputs)
    .set({
      ...updates,
      updatedBy: userId
    })
    .where(and(...conditions))
    .returning()

  if (!input) {
    throw createError({
      status: 404,
      statusText: 'TriageInput not found or unauthorized'
    })
  }

  return input
}

export async function deleteTriageInput(
  recordId: string,
  teamId: string,
  userId: string,
  options?: { role?: string }
) {
  const db = useDB()
  const isAdmin = options?.role === 'admin' || options?.role === 'owner'

  const conditions = [
    eq(tables.triageInputs.id, recordId),
    eq(tables.triageInputs.teamId, teamId),
  ]
  if (!isAdmin) {
    conditions.push(eq(tables.triageInputs.owner, userId))
  }

  const [deleted] = await (db as any)
    .delete(tables.triageInputs)
    .where(and(...conditions))
    .returning()

  if (!deleted) {
    throw createError({
      status: 404,
      statusText: 'TriageInput not found or unauthorized'
    })
  }

  return { success: true }
}