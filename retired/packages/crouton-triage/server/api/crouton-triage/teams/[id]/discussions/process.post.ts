/**
 * Internal Processor Endpoint
 *
 * Provides programmatic access to the discussion processor for:
 * - Manual processing (testing/debugging)
 * - Reprocessing existing discussions
 * - Retrying failed discussions
 * - Admin UI operations
 *
 * **Endpoint:** POST /api/discussions/process
 * **Auth:** Required (team member or admin)
 *
 * **Request Modes:**
 *
 * 1. **Direct Processing** - Process a discussion directly (testing/manual)
 * ```json
 * {
 *   "type": "direct",
 *   "parsed": {
 *     "sourceType": "figma",
 *     "sourceThreadId": "comment-123",
 *     "sourceUrl": "https://figma.com/...",
 *     "teamId": "team_xyz",
 *     "authorHandle": "jane@company.com",
 *     "title": "Design feedback",
 *     "content": "Discussion content"
 *   },
 *   "options": {
 *     "thread": { ... },
 *     "config": { ... },
 *     "skipAI": false,
 *     "skipNotion": false
 *   }
 * }
 * ```
 *
 * 2. **Reprocess by ID** - Reprocess an existing discussion
 * ```json
 * {
 *   "type": "reprocess",
 *   "discussionId": "disc_123"
 * }
 * ```
 *
 * 3. **Retry Failed** - Retry a failed discussion with backoff
 * ```json
 * {
 *   "type": "retry",
 *   "discussionId": "disc_123"
 * }
 * ```
 */

import type { ParsedDiscussion, DiscussionThread, AdapterConfig } from '../../../../../../app/types'
import {
  processDiscussion,
  processDiscussionById,
  retryFailedDiscussion,
} from '../../../../../services/processor'

/**
 * Request payload for direct processing
 */
interface DirectProcessRequest {
  type: 'direct'
  parsed: ParsedDiscussion
  options?: {
    thread?: DiscussionThread
    config?: AdapterConfig
    skipAI?: boolean
    skipNotion?: boolean
  }
}

/**
 * Request payload for reprocessing by ID
 */
interface ReprocessRequest {
  type: 'reprocess'
  discussionId: string
}

/**
 * Request payload for retrying failed discussions
 */
interface RetryRequest {
  type: 'retry'
  discussionId: string
}

/**
 * Union type of all request modes
 */
type ProcessRequest = DirectProcessRequest | ReprocessRequest | RetryRequest

/**
 * Validate request payload structure
 */
function validateRequest(body: any): asserts body is ProcessRequest {
  if (!body || typeof body !== 'object') {
    throw createError({
      statusCode: 400,
      statusMessage: 'Invalid request body',
      data: { error: 'Request body must be a JSON object' },
    })
  }

  if (!body.type) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Missing request type',
      data: { error: 'Request must include "type" field' },
    })
  }

  // Validate based on type
  if (body.type === 'direct') {
    if (!body.parsed) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Missing parsed discussion',
        data: { error: 'Direct processing requires "parsed" field' },
      })
    }

    // Validate required fields in parsed discussion
    const required = [
      'sourceType',
      'sourceThreadId',
      'sourceUrl',
      'teamId',
      'authorHandle',
      'title',
      'content',
    ]
    const missing = required.filter(field => !body.parsed[field])

    if (missing.length > 0) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Invalid parsed discussion',
        data: {
          error: `Missing required fields in parsed discussion: ${missing.join(', ')}`,
        },
      })
    }
  }
  else if (body.type === 'reprocess' || body.type === 'retry') {
    if (!body.discussionId) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Missing discussion ID',
        data: { error: `${body.type} requires "discussionId" field` },
      })
    }
  }
  else {
    throw createError({
      statusCode: 400,
      statusMessage: 'Invalid request type',
      data: {
        error: `Invalid type "${body.type}". Must be "direct", "reprocess", or "retry"`,
      },
    })
  }
}

export default defineEventHandler(async (event) => {
  const startTime = Date.now()

  try {
    // 1. Read and validate request
    const body = await readBody(event)

    logger.debug('[Processor Endpoint] Received request', {
      type: body?.type,
      discussionId: body?.discussionId,
      teamId: body?.parsed?.teamId,
    })

    validateRequest(body)

    // 2. Authenticate user
    await requireAuth(event)

    // 3. Process based on type
    let result

    switch (body.type) {
      case 'direct': {
        logger.debug('[Processor Endpoint] Processing direct discussion', {
          sourceType: body.parsed.sourceType,
          sourceThreadId: body.parsed.sourceThreadId,
          hasThread: !!body.options?.thread,
          hasConfig: !!body.options?.config,
          skipAI: body.options?.skipAI,
          skipNotion: body.options?.skipNotion,
        })

        result = await processDiscussion(body.parsed, {
          ...body.options,
          correlationId: event.context.correlationId,
        })
        break
      }

      case 'reprocess': {
        logger.debug('[Processor Endpoint] Reprocessing discussion', {
          discussionId: body.discussionId,
        })

        result = await processDiscussionById(body.discussionId)
        break
      }

      case 'retry': {
        logger.debug('[Processor Endpoint] Retrying failed discussion', {
          discussionId: body.discussionId,
        })

        result = await retryFailedDiscussion(body.discussionId)
        break
      }

      default:
        // TypeScript should prevent this, but handle it anyway
        throw createError({
          statusCode: 400,
          statusMessage: 'Invalid request type',
        })
    }

    const processingTime = Date.now() - startTime

    logger.debug('[Processor Endpoint] Processing complete', {
      type: body.type,
      discussionId: result.discussionId,
      notionTaskCount: result.notionTasks.length,
      isMultiTask: result.isMultiTask,
      processingTime: `${processingTime}ms`,
    })

    // 4. Return success response
    return {
      success: true,
      data: {
        discussionId: result.discussionId,
        aiAnalysis: {
          summary: result.aiAnalysis.summary.summary,
          keyPoints: result.aiAnalysis.summary.keyPoints,
          taskCount: result.aiAnalysis.taskDetection.tasks.length,
          isMultiTask: result.aiAnalysis.taskDetection.isMultiTask,
          cached: result.aiAnalysis.cached,
        },
        notionTasks: result.notionTasks.map((task: any) => ({
          taskId: task.taskId,
          url: task.url,
        })),
        processingTime: result.processingTime,
        totalTime: processingTime,
      },
    }
  }
  catch (error) {
    logger.error('[Processor Endpoint] Processing failed:', error)

    // If this is already a H3Error from createError(), re-throw it
    if ((error as any).statusCode) {
      throw error
    }

    // Handle ProcessingError from processor service
    if ((error as any).name === 'ProcessingError') {
      const procError = error as any
      throw createError({
        statusCode: procError.retryable ? 503 : 422,
        statusMessage: 'Processing failed',
        data: {
          error: procError.message,
          stage: procError.stage,
          context: procError.context,
          retryable: procError.retryable,
        },
      })
    }

    // Otherwise, wrap in a generic error
    throw createError({
      statusCode: 500,
      statusMessage: 'Internal server error',
      data: {
        error: (error as Error).message,
      },
    })
  }
})
