// Generated with JSON field post-processing support (v2025-01-11)
import { eq, and, desc, inArray } from 'drizzle-orm'
import { alias } from 'drizzle-orm/sqlite-core'
import * as tables from './schema'
import type { TriageOutput, NewTriageOutput } from '../../types'
import * as flowsSchema from '../../../flows/server/database/schema'
import { user } from '~~/server/db/schema'

export async function getAllTriageOutputs(teamId: string) {
  const db = useDB()

  const ownerUser = alias(user as any, 'ownerUser')
  const createdByUser = alias(user as any, 'createdByUser')
  const updatedByUser = alias(user as any, 'updatedByUser')

  const outputs = await (db as any)
    .select({
      ...tables.triageOutputs,
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
    .from(tables.triageOutputs)
    .leftJoin(flowsSchema.triageFlows, eq(tables.triageOutputs.flowId, flowsSchema.triageFlows.id))
    .leftJoin(ownerUser, eq(tables.triageOutputs.owner, ownerUser.id))
    .leftJoin(createdByUser, eq(tables.triageOutputs.createdBy, createdByUser.id))
    .leftJoin(updatedByUser, eq(tables.triageOutputs.updatedBy, updatedByUser.id))
    .where(eq(tables.triageOutputs.teamId, teamId))
    .orderBy(desc(tables.triageOutputs.createdAt))

  // Post-query processing for JSON fields (repeater/json types)
  outputs.forEach((item: any) => {
      // Parse outputConfig from JSON string
      if (typeof item.outputConfig === 'string') {
        try {
          item.outputConfig = JSON.parse(item.outputConfig)
        } catch (e) {
          console.error('Error parsing outputConfig:', e)
          item.outputConfig = null
        }
      }
      if (item.outputConfig === null || item.outputConfig === undefined) {
        item.outputConfig = null
      }
  })

  return outputs
}

export async function getTriageOutputsByIds(teamId: string, outputIds: string[]) {
  const db = useDB()

  const ownerUser = alias(user as any, 'ownerUser')
  const createdByUser = alias(user as any, 'createdByUser')
  const updatedByUser = alias(user as any, 'updatedByUser')

  const outputs = await (db as any)
    .select({
      ...tables.triageOutputs,
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
    .from(tables.triageOutputs)
    .leftJoin(flowsSchema.triageFlows, eq(tables.triageOutputs.flowId, flowsSchema.triageFlows.id))
    .leftJoin(ownerUser, eq(tables.triageOutputs.owner, ownerUser.id))
    .leftJoin(createdByUser, eq(tables.triageOutputs.createdBy, createdByUser.id))
    .leftJoin(updatedByUser, eq(tables.triageOutputs.updatedBy, updatedByUser.id))
    .where(
      and(
        eq(tables.triageOutputs.teamId, teamId),
        inArray(tables.triageOutputs.id, outputIds)
      )
    )
    .orderBy(desc(tables.triageOutputs.createdAt))

  // Post-query processing for JSON fields (repeater/json types)
  outputs.forEach((item: any) => {
      // Parse outputConfig from JSON string
      if (typeof item.outputConfig === 'string') {
        try {
          item.outputConfig = JSON.parse(item.outputConfig)
        } catch (e) {
          console.error('Error parsing outputConfig:', e)
          item.outputConfig = null
        }
      }
      if (item.outputConfig === null || item.outputConfig === undefined) {
        item.outputConfig = null
      }
  })

  return outputs
}

export async function createTriageOutput(data: NewTriageOutput) {
  const db = useDB()

  const [output] = await (db as any)
    .insert(tables.triageOutputs)
    .values(data)
    .returning()

  return output
}

export async function updateTriageOutput(
  recordId: string,
  teamId: string,
  userId: string,
  updates: Partial<TriageOutput>,
  options?: { role?: string }
) {
  const db = useDB()
  const isAdmin = options?.role === 'admin' || options?.role === 'owner'

  const conditions = [
    eq(tables.triageOutputs.id, recordId),
    eq(tables.triageOutputs.teamId, teamId),
  ]
  if (!isAdmin) {
    conditions.push(eq(tables.triageOutputs.owner, userId))
  }

  const [output] = await (db as any)
    .update(tables.triageOutputs)
    .set({
      ...updates,
      updatedBy: userId
    })
    .where(and(...conditions))
    .returning()

  if (!output) {
    throw createError({
      status: 404,
      statusText: 'TriageOutput not found or unauthorized'
    })
  }

  return output
}

export async function deleteTriageOutput(
  recordId: string,
  teamId: string,
  userId: string,
  options?: { role?: string }
) {
  const db = useDB()
  const isAdmin = options?.role === 'admin' || options?.role === 'owner'

  const conditions = [
    eq(tables.triageOutputs.id, recordId),
    eq(tables.triageOutputs.teamId, teamId),
  ]
  if (!isAdmin) {
    conditions.push(eq(tables.triageOutputs.owner, userId))
  }

  const [deleted] = await (db as any)
    .delete(tables.triageOutputs)
    .where(and(...conditions))
    .returning()

  if (!deleted) {
    throw createError({
      status: 404,
      statusText: 'TriageOutput not found or unauthorized'
    })
  }

  return { success: true }
}