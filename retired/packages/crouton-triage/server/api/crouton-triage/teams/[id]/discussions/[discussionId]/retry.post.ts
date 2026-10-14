/**
 * Manual Retry Endpoint for Failed Discussions
 *
 * POST /api/discussions/[id]/retry
 *
 * Loads a failed discussion from the database and retries processing.
 * Creates a NEW job record for the retry attempt (per Phase 6 design).
 *
 * @param id - Discussion ID to retry (from route parameter)
 * @body skipAI - Optional: Skip AI analysis (for testing)
 * @body skipNotion - Optional: Skip Notion task creation (for testing)
 *
 * @returns Processing result with AI analysis and created tasks
 */

/// <reference path="../../../../../../crouton-hooks.d.ts" />

import { useNitroApp } from 'nitropack/runtime'
import { resolveTeamAndCheckMembership } from '#crouton/team-auth'
import { getTriageDiscussionsByIds } from '~~/layers/triage/collections/discussions/server/database/queries'
import { createTriageJob } from '~~/layers/triage/collections/jobs/server/database/queries'
import { processDiscussion } from '../../../../../../services/processor'
import { SYSTEM_USER_ID } from '../../../../../../utils/constants'
import type { ParsedDiscussion, DiscussionThread } from '../../../../../../../app/types'

interface RetryRequestBody {
  skipAI?: boolean
  skipNotion?: boolean
}

export default defineEventHandler(async (event) => {
  const startTime = Date.now()

  try {
    // 1. Authenticate and get team context
    const { team, user } = await resolveTeamAndCheckMembership(event)

    logger.debug('[Retry Endpoint] User authenticated', {
      userId: user.id,
      teamId: team.id
    })

    // 2. Extract discussion ID from route parameter
    // Route is /teams/[id]/discussions/[discussionId]/retry — two params,
    // so we need 'discussionId' explicitly (not 'id' which is the team id).
    const discussionId = getRouterParam(event, 'discussionId')

    if (!discussionId) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Missing discussion ID',
        data: { error: 'Discussion ID is required in the route parameter' }
      })
    }

    // 3. Parse request body (optional skip flags)
    const body = await readBody<RetryRequestBody>(event).catch(() => ({} as RetryRequestBody))

    logger.debug('[Retry Endpoint] Retrying discussion', {
      discussionId,
      teamId: team.id,
      skipAI: body?.skipAI,
      skipNotion: body?.skipNotion
    })

    // 4. Load discussion from database
    const discussions = await getTriageDiscussionsByIds(team.id, [discussionId])

    if (!discussions || discussions.length === 0) {
      throw createError({
        statusCode: 404,
        statusMessage: 'Discussion not found',
        data: {
          error: `Discussion ${discussionId} not found or not accessible by team ${team.id}`
        }
      })
    }

    const discussion = discussions[0]!

    // 5. Validate discussion is retryable (must be in failed status)
    if (discussion.status !== 'failed') {
      throw createError({
        statusCode: 422,
        statusMessage: 'Discussion is not retryable',
        data: {
          error: 'Only failed discussions can be retried',
          currentStatus: discussion.status,
          discussionId: discussion.id
        }
      })
    }

    logger.debug('[Retry Endpoint] Discussion loaded', {
      discussionId: discussion.id,
      status: discussion.status,
      sourceType: discussion.sourceType,
      hasThreadData: !!discussion.threadData
    })

    // 6. Reconstruct ParsedDiscussion from database record
    const parsed: ParsedDiscussion = {
      sourceType: discussion.sourceType as string,
      sourceThreadId: discussion.sourceThreadId as string,
      sourceUrl: discussion.sourceUrl as string,
      teamId: discussion.teamId as string,
      authorHandle: discussion.authorHandle as string,
      title: discussion.title as string,
      content: discussion.content as string,
      participants: (discussion.participants as string[]) || [],
      timestamp: discussion.createdAt ? new Date(discussion.createdAt as Date | string | number) : new Date(),
      metadata: (discussion.metadata as Record<string, any>) || {}
    }

    // 7. Create NEW job record for this retry attempt
    const job = await createTriageJob({
      teamId: discussion.teamId as string,
      owner: SYSTEM_USER_ID,
      createdBy: SYSTEM_USER_ID,
      updatedBy: SYSTEM_USER_ID,
      discussionId: discussion.id as string,
      flowInputId: discussion.flowInputId as string,
      status: 'pending' as const,
      stage: 'ingestion' as const,
      attempts: 0, // Fresh attempt counter
      maxAttempts: 3,
      error: undefined,
      errorStack: undefined,
      startedAt: new Date(),
      completedAt: undefined,
      processingTime: undefined,
      taskIds: [],
      metadata: {
        sourceType: discussion.sourceType,
        sourceThreadId: discussion.sourceThreadId,
        isRetry: true,
        originalDiscussionId: discussion.id,
        retryTimestamp: Date.now(),
        retriedBy: user.id
      }
    })

    logger.debug('[Retry Endpoint] New job created', {
      jobId: job?.id,
      discussionId: discussion.id,
      isRetry: true
    })

    // 8. Process discussion with optional thread data and skip flags
    const options: {
      thread?: DiscussionThread
      skipAI?: boolean
      skipNotion?: boolean
    } = {
      skipAI: body?.skipAI,
      skipNotion: body?.skipNotion
    }

    // If threadData exists in DB, pass it to avoid re-fetching from source
    if (discussion.threadData && Object.keys(discussion.threadData).length > 0) {
      options.thread = discussion.threadData as DiscussionThread
      logger.debug('[Retry Endpoint] Reusing stored thread data')
    }

    // Emit retry telemetry
    useNitroApp().hooks.callHook('crouton:operation', {
      type: 'webhook:retry',
      source: 'crouton-triage',
      teamId: team.id,
      correlationId: event.context.correlationId,
      metadata: {
        attempt: job?.id ? 1 : 0,
        discussionId: discussion.id,
        sourceType: discussion.sourceType,
      },
    }).catch(() => {})

    // Call processor
    const result = await processDiscussion(parsed, options)

    logger.debug('[Retry Endpoint] Retry complete', {
      discussionId: result.discussionId,
      jobId: job?.id,
      notionTaskCount: result.notionTasks.length,
      processingTime: `${result.processingTime}ms`,
      totalTime: `${Date.now() - startTime}ms`
    })

    // 9. Return success response
    return {
      success: true,
      data: {
        discussionId: result.discussionId,
        jobId: job?.id,
        aiAnalysis: {
          summary: result.aiAnalysis.summary.summary,
          keyPoints: result.aiAnalysis.summary.keyPoints,
          taskCount: result.aiAnalysis.taskDetection.tasks.length,
          isMultiTask: result.aiAnalysis.taskDetection.isMultiTask,
          cached: result.aiAnalysis.cached
        },
        notionTasks: result.notionTasks.map((task: any) => ({
          id: task.id,
          url: task.url,
          createdAt: task.createdAt
        })),
        processingTime: result.processingTime,
        isRetry: true
      }
    }

  } catch (error) {
    logger.error('[Retry Endpoint] Retry failed:', error)

    // If this is already a H3Error from createError(), re-throw it
    if ((error as any).statusCode) {
      throw error
    }

    // Handle ProcessingError from processor service
    if ((error as any).name === 'ProcessingError') {
      const procError = error as any
      throw createError({
        statusCode: procError.retryable ? 503 : 422,
        statusMessage: 'Retry processing failed',
        data: {
          error: procError.message,
          stage: procError.stage,
          context: procError.context,
          retryable: procError.retryable
        }
      })
    }

    // Generic unexpected error
    throw createError({
      statusCode: 500,
      statusMessage: 'Internal server error',
      data: {
        error: (error as Error).message,
        type: (error as Error).name
      }
    })
  }
})
