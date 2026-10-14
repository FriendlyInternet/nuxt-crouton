// Generated with JSON field post-processing support (v2025-01-11)
import { eq, and, desc, inArray } from 'drizzle-orm'
import { alias } from 'drizzle-orm/sqlite-core'
import * as tables from './schema'
import type { TriageTask, NewTriageTask } from '../../types'
import * as discussionsSchema from '../../../discussions/server/database/schema'
import * as jobsSchema from '../../../jobs/server/database/schema'
import { user } from '~~/server/db/schema'

export async function getAllTriageTasks(teamId: string) {
  const db = useDB()

  const ownerUser = alias(user as any, 'ownerUser')
  const createdByUser = alias(user as any, 'createdByUser')
  const updatedByUser = alias(user as any, 'updatedByUser')

  const tasks = await (db as any)
    .select({
      ...tables.triageTasks,
      discussionIdData: discussionsSchema.triageDiscussions,
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
    .from(tables.triageTasks)
    .leftJoin(discussionsSchema.triageDiscussions, eq(tables.triageTasks.discussionId, discussionsSchema.triageDiscussions.id))
    .leftJoin(jobsSchema.triageJobs, eq(tables.triageTasks.syncJobId, jobsSchema.triageJobs.id))
    .leftJoin(ownerUser, eq(tables.triageTasks.owner, ownerUser.id))
    .leftJoin(createdByUser, eq(tables.triageTasks.createdBy, createdByUser.id))
    .leftJoin(updatedByUser, eq(tables.triageTasks.updatedBy, updatedByUser.id))
    .where(eq(tables.triageTasks.teamId, teamId))
    .orderBy(desc(tables.triageTasks.createdAt))

  // Post-query processing for JSON fields (repeater/json types)
  tasks.forEach((item: any) => {
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

  return tasks
}

export async function getTriageTasksByIds(teamId: string, taskIds: string[]) {
  const db = useDB()

  const ownerUser = alias(user as any, 'ownerUser')
  const createdByUser = alias(user as any, 'createdByUser')
  const updatedByUser = alias(user as any, 'updatedByUser')

  const tasks = await (db as any)
    .select({
      ...tables.triageTasks,
      discussionIdData: discussionsSchema.triageDiscussions,
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
    .from(tables.triageTasks)
    .leftJoin(discussionsSchema.triageDiscussions, eq(tables.triageTasks.discussionId, discussionsSchema.triageDiscussions.id))
    .leftJoin(jobsSchema.triageJobs, eq(tables.triageTasks.syncJobId, jobsSchema.triageJobs.id))
    .leftJoin(ownerUser, eq(tables.triageTasks.owner, ownerUser.id))
    .leftJoin(createdByUser, eq(tables.triageTasks.createdBy, createdByUser.id))
    .leftJoin(updatedByUser, eq(tables.triageTasks.updatedBy, updatedByUser.id))
    .where(
      and(
        eq(tables.triageTasks.teamId, teamId),
        inArray(tables.triageTasks.id, taskIds)
      )
    )
    .orderBy(desc(tables.triageTasks.createdAt))

  // Post-query processing for JSON fields (repeater/json types)
  tasks.forEach((item: any) => {
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

  return tasks
}

export async function createTriageTask(data: NewTriageTask) {
  const db = useDB()

  const [task] = await (db as any)
    .insert(tables.triageTasks)
    .values(data)
    .returning()

  return task
}

export async function updateTriageTask(
  recordId: string,
  teamId: string,
  userId: string,
  updates: Partial<TriageTask>,
  options?: { role?: string }
) {
  const db = useDB()
  const isAdmin = options?.role === 'admin' || options?.role === 'owner'

  const conditions = [
    eq(tables.triageTasks.id, recordId),
    eq(tables.triageTasks.teamId, teamId),
  ]
  if (!isAdmin) {
    conditions.push(eq(tables.triageTasks.owner, userId))
  }

  const [task] = await (db as any)
    .update(tables.triageTasks)
    .set({
      ...updates,
      updatedBy: userId
    })
    .where(and(...conditions))
    .returning()

  if (!task) {
    throw createError({
      status: 404,
      statusText: 'TriageTask not found or unauthorized'
    })
  }

  return task
}

export async function deleteTriageTask(
  recordId: string,
  teamId: string,
  userId: string,
  options?: { role?: string }
) {
  const db = useDB()
  const isAdmin = options?.role === 'admin' || options?.role === 'owner'

  const conditions = [
    eq(tables.triageTasks.id, recordId),
    eq(tables.triageTasks.teamId, teamId),
  ]
  if (!isAdmin) {
    conditions.push(eq(tables.triageTasks.owner, userId))
  }

  const [deleted] = await (db as any)
    .delete(tables.triageTasks)
    .where(and(...conditions))
    .returning()

  if (!deleted) {
    throw createError({
      status: 404,
      statusText: 'TriageTask not found or unauthorized'
    })
  }

  return { success: true }
}