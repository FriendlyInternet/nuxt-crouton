// Generated with JSON field post-processing support (v2025-01-11)
import { eq, and, desc, inArray } from 'drizzle-orm'
import { alias } from 'drizzle-orm/sqlite-core'
import * as tables from './schema'
import type { TriageFlow, NewTriageFlow } from '../../types'
import { user } from '~~/server/db/schema'

export async function getAllTriageFlows(teamId: string) {
  const db = useDB()

  const ownerUser = alias(user as any, 'ownerUser')
  const createdByUser = alias(user as any, 'createdByUser')
  const updatedByUser = alias(user as any, 'updatedByUser')

  const flows = await (db as any)
    .select({
      ...tables.triageFlows,
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
    .from(tables.triageFlows)
    .leftJoin(ownerUser, eq(tables.triageFlows.owner, ownerUser.id))
    .leftJoin(createdByUser, eq(tables.triageFlows.createdBy, createdByUser.id))
    .leftJoin(updatedByUser, eq(tables.triageFlows.updatedBy, updatedByUser.id))
    .where(eq(tables.triageFlows.teamId, teamId))
    .orderBy(desc(tables.triageFlows.createdAt))

  return flows
}

export async function getTriageFlowsByIds(teamId: string, flowIds: string[]) {
  const db = useDB()

  const ownerUser = alias(user as any, 'ownerUser')
  const createdByUser = alias(user as any, 'createdByUser')
  const updatedByUser = alias(user as any, 'updatedByUser')

  const flows = await (db as any)
    .select({
      ...tables.triageFlows,
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
    .from(tables.triageFlows)
    .leftJoin(ownerUser, eq(tables.triageFlows.owner, ownerUser.id))
    .leftJoin(createdByUser, eq(tables.triageFlows.createdBy, createdByUser.id))
    .leftJoin(updatedByUser, eq(tables.triageFlows.updatedBy, updatedByUser.id))
    .where(
      and(
        eq(tables.triageFlows.teamId, teamId),
        inArray(tables.triageFlows.id, flowIds)
      )
    )
    .orderBy(desc(tables.triageFlows.createdAt))

  return flows
}

export async function createTriageFlow(data: NewTriageFlow) {
  const db = useDB()

  const [flow] = await (db as any)
    .insert(tables.triageFlows)
    .values(data)
    .returning()

  return flow
}

export async function updateTriageFlow(
  recordId: string,
  teamId: string,
  userId: string,
  updates: Partial<TriageFlow>,
  options?: { role?: string }
) {
  const db = useDB()
  const isAdmin = options?.role === 'admin' || options?.role === 'owner'

  const conditions = [
    eq(tables.triageFlows.id, recordId),
    eq(tables.triageFlows.teamId, teamId),
  ]
  if (!isAdmin) {
    conditions.push(eq(tables.triageFlows.owner, userId))
  }

  const [flow] = await (db as any)
    .update(tables.triageFlows)
    .set({
      ...updates,
      updatedBy: userId
    })
    .where(and(...conditions))
    .returning()

  if (!flow) {
    throw createError({
      status: 404,
      statusText: 'TriageFlow not found or unauthorized'
    })
  }

  return flow
}

export async function deleteTriageFlow(
  recordId: string,
  teamId: string,
  userId: string,
  options?: { role?: string }
) {
  const db = useDB()
  const isAdmin = options?.role === 'admin' || options?.role === 'owner'

  const conditions = [
    eq(tables.triageFlows.id, recordId),
    eq(tables.triageFlows.teamId, teamId),
  ]
  if (!isAdmin) {
    conditions.push(eq(tables.triageFlows.owner, userId))
  }

  const [deleted] = await (db as any)
    .delete(tables.triageFlows)
    .where(and(...conditions))
    .returning()

  if (!deleted) {
    throw createError({
      status: 404,
      statusText: 'TriageFlow not found or unauthorized'
    })
  }

  return { success: true }
}