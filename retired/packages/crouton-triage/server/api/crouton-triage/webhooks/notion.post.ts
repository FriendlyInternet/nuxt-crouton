/**
 * Notion Webhook Endpoint
 *
 * Receives Notion webhook events and posts status updates back to the
 * original discussion source (Slack/Figma).
 *
 * Flow:
 * 1. Notion webhook received (task status changed)
 * 2. Query triage database for task by notionPageId
 * 3. Load discussion and flow input for adapter config
 * 4. Post status update to original Slack/Figma thread
 *
 * @see https://developers.notion.com/reference/webhooks
 */

import type { AdapterConfig } from '../../../../app/types'
import { getAdapter } from '../../../adapters'
import { eq } from 'drizzle-orm'
import { logger } from '../../../utils/logger'

/**
 * Notion webhook payload structure
 * @see https://developers.notion.com/reference/webhooks
 */
interface NotionWebhookPayload {
  object: 'event'
  type: 'page' | 'database' | 'block'
  event: {
    object: 'page'
    id: string // Page ID (UUID format)
  }
  data?: {
    object: 'page'
    id: string
    properties?: {
      Status?: {
        status?: {
          name?: string
        }
      }
      [key: string]: any
    }
    [key: string]: any
  }
  [key: string]: any
}

export default defineEventHandler(async (event) => {
  logger.debug('[Notion Webhook] ===== REQUEST RECEIVED =====')
  logger.debug('[Notion Webhook] Request received', {
    method: event.method,
    path: event.path,
  })

  try {
    // Read body
    const body = await readBody<NotionWebhookPayload>(event)
    logger.debug('[Notion Webhook] Payload received', { type: body?.type })

    // ============================================================================
    // VALIDATE WEBHOOK PAYLOAD
    // ============================================================================
    if (!body || !body.data) {
      logger.debug('[Notion Webhook] Missing data in payload')
      return {
        success: true,
        message: 'Payload missing data - ignored',
      }
    }

    // Only process page update events
    if (body.type !== 'page' && body.data?.object !== 'page') {
      logger.debug('[Notion Webhook] Ignoring non-page event', { eventType: body.type })
      return {
        success: true,
        message: 'Non-page event ignored',
      }
    }

    // Extract page ID from the event
    const notionPageId = body.data.id || body.event?.id

    if (!notionPageId) {
      logger.warn('[Notion Webhook] No page ID found in webhook payload')
      return {
        success: false,
        error: 'Missing page ID',
      }
    }

    logger.debug('[Notion Webhook] Processing page', { notionPageId })

    // Extract status from webhook payload
    const status = body.data?.properties?.Status?.status?.name

    if (!status) {
      logger.debug('[Notion Webhook] No status in payload, ignoring')
      return {
        success: true,
        message: 'No status in payload - ignored',
      }
    }

    logger.debug('[Notion Webhook] Status change detected', { status })

    // ============================================================================
    // QUERY TASK BY NOTION PAGE ID
    // ============================================================================
    const db = useDB()
    const { triageTasks } = await import('~~/layers/triage/collections/tasks/server/database/schema')
    const { triageDiscussions } = await import('~~/layers/triage/collections/discussions/server/database/schema')
    const { triageInputs } = await import('~~/layers/triage/collections/inputs/server/database/schema')

    const task = await db
      .select()
      .from(triageTasks)
      .where(eq(triageTasks.notionPageId, notionPageId))
      .limit(1)
      .get()

    if (!task) {
      logger.warn('[Notion Webhook] Task not found for Notion page', { notionPageId })
      return {
        success: false,
        error: 'Task not found',
        notionPageId,
      }
    }

    logger.debug('[Notion Webhook] Found task', {
      taskId: task.id,
      discussionId: task.discussionId,
      sourceUrl: task.sourceUrl,
    })

    // ============================================================================
    // LOAD DISCUSSION
    // ============================================================================
    const discussion = await db
      .select()
      .from(triageDiscussions)
      .where(eq(triageDiscussions.id, task.discussionId))
      .limit(1)
      .get()

    if (!discussion) {
      logger.error('[Notion Webhook] Discussion not found', undefined, {
        discussionId: task.discussionId,
      })
      return {
        success: false,
        error: 'Discussion not found',
        discussionId: task.discussionId,
      }
    }

    logger.debug('[Notion Webhook] Found discussion', {
      discussionId: discussion.id,
      sourceType: discussion.sourceType,
      sourceThreadId: discussion.sourceThreadId,
      flowInputId: discussion.flowInputId,
    })

    // ============================================================================
    // LOAD FLOW INPUT (for adapter config)
    // ============================================================================
    const flowInput = await db
      .select()
      .from(triageInputs)
      .where(eq(triageInputs.id, discussion.flowInputId))
      .limit(1)
      .get()

    if (!flowInput) {
      logger.error('[Notion Webhook] FlowInput not found', undefined, {
        flowInputId: discussion.flowInputId,
      })
      return {
        success: false,
        error: 'FlowInput not found',
        flowInputId: discussion.flowInputId,
      }
    }

    // Build AdapterConfig from FlowInput
    const sourceConfig: AdapterConfig = {
      id: flowInput.id,
      teamId: flowInput.teamId,
      sourceType: flowInput.sourceType as 'slack' | 'figma',
      apiToken: flowInput.apiToken || undefined,
      sourceMetadata: (flowInput.sourceMetadata as Record<string, any>) || undefined,
      webhookUrl: flowInput.webhookUrl || undefined,
    }

    logger.debug('[Notion Webhook] Loaded FlowInput config', {
      flowInputId: flowInput.id,
      sourceType: sourceConfig.sourceType,
      teamId: sourceConfig.teamId,
    })

    // ============================================================================
    // POST COMPLETION MESSAGE TO SOURCE THREAD
    // ============================================================================
    const adapter = getAdapter(discussion.sourceType)

    // Build status update message
    const completionMessage = `Status updated to "${status}": ${task.title}\n${task.notionPageUrl}`

    logger.debug('[Notion Webhook] Posting status update to thread', {
      sourceType: discussion.sourceType,
      sourceThreadId: discussion.sourceThreadId,
      taskTitle: task.title,
      status,
    })

    const success = await adapter.postReply(
      discussion.sourceThreadId,
      completionMessage,
      sourceConfig
    )

    if (success) {
      logger.info('[Notion Webhook] ✅ Status update posted successfully', {
        taskId: task.id,
        notionPageId: task.notionPageId,
        sourceThreadId: discussion.sourceThreadId,
        sourceType: discussion.sourceType,
        status,
      })

      return {
        success: true,
        message: `Status "${status}" posted to source thread`,
        task: {
          id: task.id,
          title: task.title,
          notionPageUrl: task.notionPageUrl,
        },
        status,
        sourceThreadId: discussion.sourceThreadId,
        timestamp: new Date().toISOString(),
      }
    } else {
      logger.error('[Notion Webhook] ❌ Failed to post status update', undefined, {
        taskId: task.id,
        sourceThreadId: discussion.sourceThreadId,
        status,
      })

      return {
        success: false,
        error: 'Failed to post status update to source thread',
        task: {
          id: task.id,
          title: task.title,
        },
        status,
      }
    }

  } catch (error) {
    logger.error('[Notion Webhook] Unexpected error', error, {
      stack: (error as Error).stack,
    })

    throw createError({
      statusCode: 500,
      statusMessage: 'Internal server error',
      data: { error: (error as Error).message },
    })
  }
})
