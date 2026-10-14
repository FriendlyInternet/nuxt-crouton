/**
 * Slack Webhook Endpoint
 *
 * Receives Slack Events API webhooks and processes them through the discussion pipeline.
 *
 * Flow:
 * 1. URL verification challenge → Return challenge
 * 2. app_mention events → Parse with adapter → Process discussion → Return result
 * 3. Other events → Ignore
 *
 * **Flows Support (Phase 5):**
 * - Automatically finds flow by slackTeamId (from event.team_id)
 * - Falls back to legacy config if no flow found
 * - Flow routing handled by processor service
 *
 * @see https://api.slack.com/events-api
 */

/// <reference path="../../../crouton-hooks.d.ts" />

import { useNitroApp } from 'nitropack/runtime'
import { getAdapter } from '../../../adapters'
import { processDiscussion } from '../../../services/processor'
import type { ProcessingResult } from '../../../services/processor'
import { verifySlackSignature } from '../../../utils/webhookSecurity'
import { logger } from '../../../utils/logger'

export default defineEventHandler(async (event) => {
  logger.debug('[Slack Webhook] ===== REQUEST RECEIVED =====')
  logger.debug('[Slack Webhook] Method', { method: event.method })
  logger.debug('[Slack Webhook] Path', { path: event.path })

  try {
    // Read raw body first for signature verification
    const rawBody = await readRawBody(event) || ''
    const body = JSON.parse(rawBody || '{}')

    // Verify Slack HMAC-SHA256 signature (skip for url_verification challenges sent without signing)
    const runtimeConfig = useRuntimeConfig(event) as any
    const signingSecret = runtimeConfig?.croutonTriage?.slack?.signingSecret as string | undefined
    if (signingSecret) {
      const headers = getHeaders(event)
      if (!await verifySlackSignature(rawBody, headers, signingSecret)) {
        logger.warn('[Slack Webhook] Invalid signature — request rejected')
        throw createError({ status: 401, statusText: 'Invalid Slack signature' })
      }
      logger.debug('[Slack Webhook] Signature verified')
    }
    else {
      logger.warn('[Slack Webhook] SLACK_SIGNING_SECRET not configured — skipping signature verification')
    }
    logger.debug('[Slack Webhook] Payload type', { type: body?.type })

    // ============================================================================
    // HANDLE URL VERIFICATION CHALLENGE
    // ============================================================================
    if (body && body.type === 'url_verification') {
      logger.debug('[Slack Webhook] URL verification challenge received')
      return { challenge: body.challenge }
    }

    // ============================================================================
    // VALIDATE EVENT PAYLOAD
    // ============================================================================
    if (!body || body.type !== 'event_callback') {
      logger.debug('[Slack Webhook] Ignoring non-event payload', { type: body?.type })
      return {
        success: true,
        message: 'Non-event payload ignored',
      }
    }

    if (!body.event) {
      throw createError({
        status: 400,
        statusText: 'Missing event in payload',
      })
    }

    logger.debug('[Slack Webhook] Event type', { eventType: body.event.type })
    logger.debug('[Slack Webhook] Event details', {
      channel: body.event.channel,
      user: body.event.user,
      text: body.event.text?.substring(0, 100),
      ts: body.event.ts,
      thread_ts: body.event.thread_ts,
    })

    // ============================================================================
    // PARSE EVENT WITH SLACK ADAPTER
    // ============================================================================
    const adapter = getAdapter('slack')
    let parsed

    try {
      parsed = await adapter.parseIncoming(body)
      logger.debug('[Slack Webhook] Successfully parsed event', {
        sourceThreadId: parsed.sourceThreadId,
        teamId: parsed.teamId,
        title: parsed.title,
        authorHandle: parsed.authorHandle,
      })
    } catch (parseError: any) {
      // If it's an unsupported event type (not app_mention), just acknowledge it
      if (parseError.message?.includes('Unsupported event type')) {
        logger.debug('[Slack Webhook] Ignoring unsupported event type', { eventType: body.event.type })
        return {
          success: true,
          message: 'Event type not supported',
          event_type: body.event.type,
        }
      }

      // Otherwise, it's a real error
      logger.error('[Slack Webhook] Failed to parse event', parseError)
      throw createError({
        status: 400,
        statusText: 'Failed to parse event',
        data: { error: parseError.message },
      })
    }

    // ============================================================================
    // EMIT WEBHOOK:RECEIVED TELEMETRY
    // ============================================================================
    const correlationId = (event.context as any).correlationId
    const contentHashRaw = rawBody.length.toString(16) + '-' + (rawBody.charCodeAt(0) || 0).toString(16)
    useNitroApp().hooks.callHook('crouton:operation', {
      type: 'webhook:received',
      source: 'crouton-triage',
      correlationId,
      metadata: {
        source: 'slack',
        threadId: parsed.sourceThreadId,
        contentHash: contentHashRaw,
      },
    }).catch(() => {})

    // ============================================================================
    // PROCESS DISCUSSION
    // ============================================================================
    logger.debug('[Slack Webhook] Starting discussion processing...')

    // Use Cloudflare Workers waitUntil to process in background
    // This allows the webhook to return immediately while processing continues
    const cfCtx = (event.context as any).cloudflare?.context

    // In dev mode, NuxtHub provides a mock cfCtx that doesn't properly handle errors.
    // Force synchronous processing in dev to see errors properly.
    // Use import.meta.dev for reliable dev detection (works regardless of BASE_URL)
    const isDevMode = import.meta.dev

    if (cfCtx && !isDevMode) {
      // Production: Process in background using waitUntil
      logger.debug('[Slack Webhook] Using background processing (waitUntil)')

      cfCtx.waitUntil(
        processDiscussion(parsed, { correlationId })
          .then((result) => {
            logger.debug('[Slack Webhook] Background processing completed', {
              discussionId: result.discussionId,
              taskCount: result.notionTasks.length,
              processingTime: `${result.processingTime}ms`,
              isMultiTask: result.isMultiTask,
            })
          })
          .catch((error) => {
            logger.error('[Slack Webhook] Background processing failed', error)
            // Error is already logged in processor, job status updated to failed
          })
      )

      // Return immediately
      return {
        success: true,
        message: 'Discussion queued for background processing',
        timestamp: new Date().toISOString(),
      }
    } else {
      // Development: Process synchronously to see errors properly
      logger.info('[Slack Webhook] Using synchronous processing', { isDevMode, hasCloudflareCtx: !!cfCtx })

      let result: ProcessingResult

      try {
        result = await processDiscussion(parsed, { correlationId: (event.context as any).correlationId })

        logger.debug('[Slack Webhook] Discussion processed successfully', {
          discussionId: result.discussionId,
          taskCount: result.notionTasks.length,
          processingTime: `${result.processingTime}ms`,
          isMultiTask: result.isMultiTask,
        })
      } catch (processingError: any) {
        logger.error('[Slack Webhook] Processing failed', processingError)

        // Check if error is retryable
        const isRetryable = processingError.retryable === true
        const errorStatus = isRetryable ? 503 : 422

        throw createError({
          status: errorStatus,
          statusText: 'Processing failed',
          data: {
            error: processingError.message,
            stage: processingError.stage,
            retryable: isRetryable,
          },
        })
      }

      // Return with full result in dev mode
      return {
        success: true,
        discussionId: result.discussionId,
        taskCount: result.notionTasks.length,
        tasks: result.notionTasks.map(t => ({
          id: t.id,
          url: t.url,
        })),
        isMultiTask: result.isMultiTask,
        processingTime: result.processingTime,
        summary: result.aiAnalysis.summary.summary,
        timestamp: new Date().toISOString(),
      }
    }

  } catch (error) {
    // If error was already created by createError above, just rethrow it
    if ((error as any).statusCode) {
      throw error
    }

    // Otherwise, wrap it in a generic 500 error
    logger.error('[Slack Webhook] Unexpected error', error, { stack: (error as Error).stack })

    throw createError({
      status: 500,
      statusText: 'Internal server error',
      data: { error: (error as Error).message },
    })
  }
})