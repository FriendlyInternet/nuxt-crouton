// Generated with JSON field post-processing support (v2025-01-11)
import { eq, and, desc, inArray } from 'drizzle-orm'
import { alias } from 'drizzle-orm/sqlite-core'
import * as tables from './schema'
import type { TriageDiscussion, NewTriageDiscussion } from '../../types'
import * as inputsSchema from '../../../inputs/server/database/schema'
import * as jobsSchema from '../../../jobs/server/database/schema'
import { user } from '~~/server/db/schema'

export async function getAllTriageDiscussions(teamId: string) {
  const db = useDB()

  const ownerUser = alias(user as any, 'ownerUser')
  const createdByUser = alias(user as any, 'createdByUser')
  const updatedByUser = alias(user as any, 'updatedByUser')

  const discussions = await (db as any)
    .select({
      ...tables.triageDiscussions,
      flowInputIdData: inputsSchema.triageInputs,
      syncJobIdData: jobsSchema.triageJobs,
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
    .from(tables.triageDiscussions)
    .leftJoin(inputsSchema.triageInputs, eq(tables.triageDiscussions.flowInputId, inputsSchema.triageInputs.id))
    .leftJoin(jobsSchema.triageJobs, eq(tables.triageDiscussions.syncJobId, jobsSchema.triageJobs.id))
    .leftJoin(ownerUser, eq(tables.triageDiscussions.owner, ownerUser.id))
    .leftJoin(createdByUser, eq(tables.triageDiscussions.createdBy, createdByUser.id))
    .leftJoin(updatedByUser, eq(tables.triageDiscussions.updatedBy, updatedByUser.id))
    .where(eq(tables.triageDiscussions.teamId, teamId))
    .orderBy(desc(tables.triageDiscussions.createdAt))

  // Post-query processing for JSON fields (repeater/json types)
  discussions.forEach((item: any) => {
      // Parse threadData from JSON string
      if (typeof item.threadData === 'string') {
        try {
          item.threadData = JSON.parse(item.threadData)
        } catch (e) {
          console.error('Error parsing threadData:', e)
          item.threadData = null
        }
      }
      if (item.threadData === null || item.threadData === undefined) {
        item.threadData = null
      }
      // Parse aiTasks from JSON string
      if (typeof item.aiTasks === 'string') {
        try {
          item.aiTasks = JSON.parse(item.aiTasks)
        } catch (e) {
          console.error('Error parsing aiTasks:', e)
          item.aiTasks = null
        }
      }
      if (item.aiTasks === null || item.aiTasks === undefined) {
        item.aiTasks = null
      }
      // Parse rawPayload from JSON string
      if (typeof item.rawPayload === 'string') {
        try {
          item.rawPayload = JSON.parse(item.rawPayload)
        } catch (e) {
          console.error('Error parsing rawPayload:', e)
          item.rawPayload = null
        }
      }
      if (item.rawPayload === null || item.rawPayload === undefined) {
        item.rawPayload = null
      }
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

  return discussions
}

export async function getTriageDiscussionsByIds(teamId: string, discussionIds: string[]) {
  const db = useDB()

  const ownerUser = alias(user as any, 'ownerUser')
  const createdByUser = alias(user as any, 'createdByUser')
  const updatedByUser = alias(user as any, 'updatedByUser')

  const discussions = await (db as any)
    .select({
      ...tables.triageDiscussions,
      flowInputIdData: inputsSchema.triageInputs,
      syncJobIdData: jobsSchema.triageJobs,
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
    .from(tables.triageDiscussions)
    .leftJoin(inputsSchema.triageInputs, eq(tables.triageDiscussions.flowInputId, inputsSchema.triageInputs.id))
    .leftJoin(jobsSchema.triageJobs, eq(tables.triageDiscussions.syncJobId, jobsSchema.triageJobs.id))
    .leftJoin(ownerUser, eq(tables.triageDiscussions.owner, ownerUser.id))
    .leftJoin(createdByUser, eq(tables.triageDiscussions.createdBy, createdByUser.id))
    .leftJoin(updatedByUser, eq(tables.triageDiscussions.updatedBy, updatedByUser.id))
    .where(
      and(
        eq(tables.triageDiscussions.teamId, teamId),
        inArray(tables.triageDiscussions.id, discussionIds)
      )
    )
    .orderBy(desc(tables.triageDiscussions.createdAt))

  // Post-query processing for JSON fields (repeater/json types)
  discussions.forEach((item: any) => {
      // Parse threadData from JSON string
      if (typeof item.threadData === 'string') {
        try {
          item.threadData = JSON.parse(item.threadData)
        } catch (e) {
          console.error('Error parsing threadData:', e)
          item.threadData = null
        }
      }
      if (item.threadData === null || item.threadData === undefined) {
        item.threadData = null
      }
      // Parse aiTasks from JSON string
      if (typeof item.aiTasks === 'string') {
        try {
          item.aiTasks = JSON.parse(item.aiTasks)
        } catch (e) {
          console.error('Error parsing aiTasks:', e)
          item.aiTasks = null
        }
      }
      if (item.aiTasks === null || item.aiTasks === undefined) {
        item.aiTasks = null
      }
      // Parse rawPayload from JSON string
      if (typeof item.rawPayload === 'string') {
        try {
          item.rawPayload = JSON.parse(item.rawPayload)
        } catch (e) {
          console.error('Error parsing rawPayload:', e)
          item.rawPayload = null
        }
      }
      if (item.rawPayload === null || item.rawPayload === undefined) {
        item.rawPayload = null
      }
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

  return discussions
}

export async function createTriageDiscussion(data: NewTriageDiscussion) {
  const db = useDB()

  const [discussion] = await (db as any)
    .insert(tables.triageDiscussions)
    .values(data)
    .returning()

  return discussion
}

export async function updateTriageDiscussion(
  recordId: string,
  teamId: string,
  userId: string,
  updates: Partial<TriageDiscussion>,
  options?: { role?: string }
) {
  const db = useDB()
  const isAdmin = options?.role === 'admin' || options?.role === 'owner'

  const conditions = [
    eq(tables.triageDiscussions.id, recordId),
    eq(tables.triageDiscussions.teamId, teamId),
  ]
  if (!isAdmin) {
    conditions.push(eq(tables.triageDiscussions.owner, userId))
  }

  const [discussion] = await (db as any)
    .update(tables.triageDiscussions)
    .set({
      ...updates,
      updatedBy: userId
    })
    .where(and(...conditions))
    .returning()

  if (!discussion) {
    throw createError({
      status: 404,
      statusText: 'TriageDiscussion not found or unauthorized'
    })
  }

  return discussion
}

export async function deleteTriageDiscussion(
  recordId: string,
  teamId: string,
  userId: string,
  options?: { role?: string }
) {
  const db = useDB()
  const isAdmin = options?.role === 'admin' || options?.role === 'owner'

  const conditions = [
    eq(tables.triageDiscussions.id, recordId),
    eq(tables.triageDiscussions.teamId, teamId),
  ]
  if (!isAdmin) {
    conditions.push(eq(tables.triageDiscussions.owner, userId))
  }

  const [deleted] = await (db as any)
    .delete(tables.triageDiscussions)
    .where(and(...conditions))
    .returning()

  if (!deleted) {
    throw createError({
      status: 404,
      statusText: 'TriageDiscussion not found or unauthorized'
    })
  }

  return { success: true }
}