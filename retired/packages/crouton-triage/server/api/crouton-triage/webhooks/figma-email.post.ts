/**
 * Mailgun Webhook Endpoint - Figma Email Handler
 *
 * Receives POST requests from Mailgun containing Figma comment emails.
 * Processes the email and creates a discussion with AI analysis and Notion tasks.
 *
 * **Flow:**
 * 1. Receive Mailgun webhook payload
 * 2. Parse email using Figma adapter
 * 3. Process discussion through pipeline
 * 4. Return success/error response
 *
 * **Mailgun Payload Structure:**
 * ```json
 * {
 *   "subject": "Jane commented on Design File",
 *   "from": "jane@company.com",
 *   "recipient": "team-slug@triage.example.com",
 *   "body-plain": "Plain text content",
 *   "body-html": "<html>...</html>",
 *   "stripped-text": "Stripped plain text",
 *   "timestamp": 1699999999
 * }
 * ```
 *
 * **Endpoint:** POST /api/webhooks/mailgun
 * **Auth:** None (public webhook - signature verification deferred to Phase 6)
 *
 * @see https://documentation.mailgun.com/en/latest/api-sending.html#webhooks
 */

/// <reference path="../../../crouton-hooks.d.ts" />

import { useNitroApp } from 'nitropack/runtime'
import type { ParsedDiscussion } from '../../../../app/types'
import { getAdapter } from '../../../adapters'
import { processDiscussion } from '../../../services/processor'
import { verifyMailgunSignature } from '../../../utils/webhookSecurity'
import { rateLimit, RateLimitPresets } from '../../../utils/rateLimit'

/**
 * Mailgun webhook payload structure
 */
interface MailgunPayload {
  subject?: string
  from?: string
  recipient?: string
  'body-plain'?: string
  'body-html'?: string
  'stripped-text'?: string
  timestamp?: number
  signature?: {
    timestamp: string | number
    token: string
    signature: string
  }
  [key: string]: any
}

/**
 * Validate required Mailgun fields are present
 */
function validateMailgunPayload(payload: MailgunPayload): void {
  const errors: string[] = []

  // Check for essential email fields
  if (!payload.recipient) {
    errors.push('Missing required field: recipient')
  }

  // Must have at least one form of body content
  if (!payload['body-plain'] && !payload['body-html'] && !payload['stripped-text']) {
    errors.push('Missing email body (need body-plain, body-html, or stripped-text)')
  }

  if (errors.length > 0) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Invalid Mailgun payload',
      data: { errors },
    })
  }
}

export default defineEventHandler(async (event) => {
  const startTime = Date.now()

  try {
    // 0. Apply rate limiting (100 requests per minute)
    await rateLimit(event, RateLimitPresets.WEBHOOK)

    // 1. Read and validate incoming payload
    const payload = await readBody<MailgunPayload>(event)

    // 1.5. Verify webhook signature if present
    const config = useRuntimeConfig(event)
    const signingKey = config.mailgunSigningKey as string | undefined

    if (signingKey && payload.signature) {
      const { timestamp, token, signature } = payload.signature

      if (!await verifyMailgunSignature(timestamp, token, signature, signingKey)) {
        logger.warn('[Mailgun Webhook] Invalid signature detected')
        throw createError({
          statusCode: 401,
          statusMessage: 'Invalid webhook signature',
        })
      }

      logger.debug('[Mailgun Webhook] Signature verified successfully')
    }
    else if (!signingKey) {
      logger.warn('[Mailgun Webhook] Signature verification skipped - MAILGUN_SIGNING_KEY not configured')
    }

    logger.debug('[Mailgun Webhook] Received webhook', {
      recipient: payload.recipient,
      from: payload.from,
      subject: payload.subject,
    })

    // Validate required fields
    validateMailgunPayload(payload)

    // 2. Get Figma adapter and parse incoming email
    // Note: Currently hardcoded to 'figma' - could be made dynamic based on
    // recipient domain or other routing logic in the future
    const adapter = getAdapter('figma')

    let parsed: ParsedDiscussion
    try {
      parsed = await adapter.parseIncoming(payload)
      logger.debug('[Mailgun Webhook] Successfully parsed email', {
        teamId: parsed.teamId,
        sourceThreadId: parsed.sourceThreadId,
        authorHandle: parsed.authorHandle,
      })
    } catch (error) {
      logger.error('[Mailgun Webhook] Failed to parse email:', error)
      throw createError({
        statusCode: 422,
        statusMessage: 'Failed to parse email',
        data: {
          error: (error as Error).message,
        },
      })
    }

    // 2.5. Emit webhook:received telemetry
    const rawBodyStr = payload['body-plain'] || payload['body-html'] || payload['stripped-text'] || ''
    const contentHashRaw = rawBodyStr.length.toString(16) + '-' + (rawBodyStr.charCodeAt(0) || 0).toString(16)
    useNitroApp().hooks.callHook('crouton:operation', {
      type: 'webhook:received',
      source: 'crouton-triage',
      correlationId: event.context.correlationId,
      metadata: {
        source: 'figma',
        threadId: parsed.sourceThreadId,
        contentHash: contentHashRaw,
      },
    }).catch(() => {})

    // 3. Process the discussion through the pipeline
    try {
      const result = await processDiscussion(parsed, { correlationId: event.context.correlationId })

      const processingTime = Date.now() - startTime

      logger.debug('[Mailgun Webhook] Successfully processed discussion', {
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
          notionTasks: result.notionTasks.map((task: any) => ({
            taskId: task.taskId,
            url: task.url,
          })),
          isMultiTask: result.isMultiTask,
          processingTime,
        },
      }
    } catch (error) {
      logger.error('[Mailgun Webhook] Failed to process discussion:', error)

      // Determine if error is retryable (for webhook retry logic)
      const isRetryable = (error as any).retryable === true

      // Return 5xx for retryable errors (Mailgun will retry)
      // Return 4xx for non-retryable errors (Mailgun won't retry)
      const statusCode = isRetryable ? 503 : 422

      throw createError({
        statusCode,
        statusMessage: 'Failed to process discussion',
        data: {
          error: (error as Error).message,
          retryable: isRetryable,
        },
      })
    }
  } catch (error) {
    // Handle all other unexpected errors
    logger.error('[Mailgun Webhook] Unexpected error:', error)

    // If this is already a H3Error from createError(), re-throw it
    if ((error as any).statusCode) {
      throw error
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
