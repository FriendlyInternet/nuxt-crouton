/**
 * Notion Input Webhook Endpoint
 *
 * Receives Notion Webhooks API events and processes them through the discussion pipeline.
 *
 * Flow:
 * 1. URL verification challenge -> Return verification_token
 * 2. comment.created events -> Fetch comment -> Check trigger -> Process discussion
 * 3. Other events -> Ignore
 *
 * **Flows Support (Phase 5):**
 * - Automatically finds flow by workspace_id (from webhook payload)
 * - Falls back to legacy config if no flow found
 * - Flow routing handled by processor service
 *
 * @see https://developers.notion.com/reference/webhooks
 */

/// <reference path="../../../crouton-hooks.d.ts" />

import { useNitroApp } from 'nitropack/runtime'
import crypto from 'node:crypto'
import { getAdapter } from '../../../adapters'
import { processDiscussion } from '../../../services/processor'
import type { ProcessingResult } from '../../../services/processor'
import {
  fetchComment,
  checkForTrigger,
  DEFAULT_TRIGGER_KEYWORD,
  type NotionWebhookPayload,
} from '../../../adapters/notion'
import { logger } from '../../../utils/logger'

/**
 * Replay attack prevention window (5 minutes)
 */
const TIMESTAMP_TOLERANCE_MS = 5 * 60 * 1000

/**
 * Verify Notion webhook signature
 *
 * Notion signs webhooks using HMAC-SHA256 with the webhook signing secret.
 * The signature is sent in the `X-Notion-Signature` header.
 *
 * Algorithm:
 * 1. Extract signature from header
 * 2. Compute expected signature: HMAC-SHA256(signingSecret, rawBody)
 * 3. Compare using constant-time comparison
 *
 * @param rawBody - Raw request body string (not parsed JSON)
 * @param signature - Signature from X-Notion-Signature header
 * @param signingSecret - Notion webhook signing secret (from environment)
 * @returns true if signature is valid, false otherwise
 */
function verifyNotionSignature(
  rawBody: string,
  signature: string,
  signingSecret: string,
): boolean {
  try {
    if (!signature || !signingSecret) {
      logger.warn('[Notion Webhook] Missing signature or signing secret')
      return false
    }

    // Compute expected signature using HMAC-SHA256
    const expectedSignature = crypto
      .createHmac('sha256', signingSecret)
      .update(rawBody)
      .digest('hex')

    // Prefix with v1= if Notion uses that format (adjust based on actual Notion format)
    // Notion may use formats like: v1=<signature> or just <signature>
    const signatureToCompare = signature.startsWith('v1=')
      ? signature.slice(3)
      : signature

    // Ensure same length for timing-safe comparison
    if (signatureToCompare.length !== expectedSignature.length) {
      logger.warn('[Notion Webhook] Signature length mismatch')
      return false
    }

    // Compare using constant-time comparison (prevent timing attacks)
    return crypto.timingSafeEqual(
      Buffer.from(signatureToCompare, 'utf8'),
      Buffer.from(expectedSignature, 'utf8'),
    )
  }
  catch (error) {
    logger.error('[Notion Webhook] Error verifying signature', error)
    return false
  }
}

/**
 * Validate webhook timestamp to prevent replay attacks
 *
 * @param timestamp - ISO timestamp string from webhook payload
 * @returns true if timestamp is within tolerance window
 */
function validateTimestamp(timestamp: string | undefined): boolean {
  if (!timestamp) {
    return true // Allow if no timestamp (some events may not have it)
  }

  try {
    const eventTime = new Date(timestamp).getTime()
    const currentTime = Date.now()
    const timeDiff = Math.abs(currentTime - eventTime)

    if (timeDiff > TIMESTAMP_TOLERANCE_MS) {
      logger.warn('[Notion Webhook] Request timestamp outside tolerance window', {
        eventTime: new Date(eventTime).toISOString(),
        currentTime: new Date(currentTime).toISOString(),
        diffMinutes: (timeDiff / 60000).toFixed(2),
      })
      return false
    }

    return true
  }
  catch {
    logger.warn('[Notion Webhook] Failed to parse timestamp', { timestamp })
    return true // Allow on parse failure
  }
}

/**
 * Simple rate limiting using in-memory map
 * In production, consider using Redis or Cloudflare KV
 */
const requestCounts = new Map<string, { count: number; resetTime: number }>()
const RATE_LIMIT_WINDOW_MS = 60 * 1000 // 1 minute
const RATE_LIMIT_MAX_REQUESTS = 60 // 60 requests per minute per workspace

function checkRateLimit(workspaceId: string): boolean {
  const now = Date.now()
  const key = `notion:${workspaceId}`
  const record = requestCounts.get(key)

  if (!record || now > record.resetTime) {
    // Reset or create new record
    requestCounts.set(key, {
      count: 1,
      resetTime: now + RATE_LIMIT_WINDOW_MS,
    })
    return true
  }

  if (record.count >= RATE_LIMIT_MAX_REQUESTS) {
    logger.warn('[Notion Webhook] Rate limit exceeded', {
      workspaceId,
      count: record.count,
    })
    return false
  }

  record.count++
  return true
}

/**
 * Read the raw request body (kept for signature verification) and parse it as
 * a Notion webhook payload.
 */
async function readAndParseWebhookBody(event: any) {
  const rawBody = await readRawBody(event) as string | undefined

  if (!rawBody) {
    logger.warn('[Notion Webhook] Empty request body')
    // Return 200 to prevent retries
    return { ok: false as const, response: { success: false, message: 'Empty request body' } }
  }

  // Parse JSON body
  let body: NotionWebhookPayload & { verification_token?: string }
  try {
    body = JSON.parse(rawBody)
  }
  catch {
    logger.warn('[Notion Webhook] Invalid JSON body')
    return { ok: false as const, response: { success: false, message: 'Invalid JSON body' } }
  }

  logger.info('[Notion Webhook] Payload received', {
    type: body?.type,
    keys: Object.keys(body || {}),
    entity: body?.entity,
    data: body?.data,
  })

  return { ok: true as const, rawBody, body }
}

/**
 * Handle the Notion URL verification challenge.
 * Returns the echo response to send, or null when this is a regular event.
 */
function resolveVerificationChallenge(
  body: NotionWebhookPayload & { verification_token?: string },
): { verification_token: string } | null {
  // Notion sends: { "verification_token": "secret_..." } without a type field
  if (body && body.verification_token && !body.type) {
    logger.info('[Notion Webhook] URL verification challenge received')
    logger.info('[Notion Webhook] VERIFICATION TOKEN received', { token: body.verification_token })

    // Echo back the verification token
    return { verification_token: body.verification_token }
  }

  // Also handle if Notion adds a type field in the future
  if (body && body.type === 'url_verification' && body.verification_token) {
    logger.info('[Notion Webhook] URL verification challenge received (with type)', { token: body.verification_token })

    return { verification_token: body.verification_token }
  }

  return null
}

/**
 * Enforce webhook signature verification when a signing secret is configured.
 * Returns an error response to send, or null when the request may proceed.
 */
function enforceSignatureGate(event: any, rawBody: string) {
  const config = useRuntimeConfig(event) as any
  const signingSecret = config.notionWebhookSecret as string | undefined

  // Only verify signature if signing secret is configured
  if (signingSecret) {
    const signature = getHeader(event, 'x-notion-signature') as string | undefined
      || getHeader(event, 'X-Notion-Signature') as string | undefined

    if (!signature) {
      logger.warn('[Notion Webhook] Missing X-Notion-Signature header')
      // Return 200 to prevent retries, but log the issue
      return { success: false, message: 'Missing signature header' }
    }

    if (!verifyNotionSignature(rawBody, signature, signingSecret)) {
      logger.warn('[Notion Webhook] Invalid signature')
      return { success: false, message: 'Invalid signature' }
    }

    logger.debug('[Notion Webhook] Signature verified successfully')
  }
  else {
    logger.warn('[Notion Webhook] No signing secret configured - skipping signature verification')
  }

  return null
}

/**
 * Validate the comment.created payload structure and extract the comment
 * identifiers from it.
 *
 * Notion webhook structure (as of 2024):
 * - body.entity.id = comment ID
 * - body.entity.type = "comment"
 * - body.data.parent.id = page/block ID
 * - body.data.parent.type = "page" | "block"
 */
function extractCommentEvent(body: NotionWebhookPayload, workspaceId: string) {
  const commentId = body.entity?.id
  const parentId = body.data?.parent?.id || body.data?.page_id
  const parentType = body.data?.parent?.type || 'page'

  if (!commentId) {
    logger.warn('[Notion Webhook] Invalid comment.created payload - missing comment ID in entity')
    return { ok: false as const, response: { success: false, message: 'Invalid payload structure - missing entity.id' } }
  }

  if (!parentId) {
    logger.warn('[Notion Webhook] Missing parent ID in payload')
    return { ok: false as const, response: { success: false, message: 'Missing parent ID' } }
  }

  const integrationId = body.integration_id
  logger.info('[Notion Webhook] Comment event details', {
    commentId,
    parentId,
    parentType,
    workspaceId,
    integrationId,
  })

  return { ok: true as const, commentId, parentId, parentType, integrationId }
}

/**
 * Load the DB handle, triage schemas, and drizzle operators used by the
 * flow-input matching and auto-capture steps.
 */
async function loadTriageDb() {
  const db = useDB()
  const { triageInputs } = await import(
    '~~/layers/triage/collections/inputs/server/database/schema'
  )
  const { triageFlows } = await import(
    '~~/layers/triage/collections/flows/server/database/schema'
  )
  const { eq, and } = await import('drizzle-orm')
  return { db, triageInputs, triageFlows, eq, and }
}

type TriageDbContext = Awaited<ReturnType<typeof loadTriageDb>>

/**
 * Fetch the input's flow and return it only when it exists and is active.
 */
async function loadActiveFlow(dbCtx: TriageDbContext, flowId: string) {
  const { db, triageFlows, eq, and } = dbCtx
  const [flow] = await db
    .select()
    .from(triageFlows)
    .where(and(
      eq(triageFlows.id, flowId),
      eq(triageFlows.active, true),
    ))
    .limit(1)
  return flow
}

/**
 * First matching pass: match an input by the workspace ID stored in its
 * sourceMetadata (verifying its flow is active).
 */
async function matchInputByWorkspace(dbCtx: TriageDbContext, inputs: any[], workspaceId: string) {
  for (const input of inputs) {
    const inputWorkspaceId = input.sourceMetadata?.notionWorkspaceId
    if (inputWorkspaceId === workspaceId) {
      // Verify the flow exists and is active
      const flow = await loadActiveFlow(dbCtx, input.flowId)
      if (flow) {
        logger.info('[Notion Webhook] Matched input by workspace ID', {
          inputId: input.id,
          workspaceId,
        })
        return { matchedInput: input, matchedFlow: flow }
      }
    }
  }
  return null
}

/**
 * Fallback matching pass when no workspace ID matched: only use an input when
 * it's unambiguous (a single token-carrying input), or disambiguate by
 * integration ID, or (dev/testing) fall back to the first with a warning.
 * This prevents accidentally matching the wrong workspace when multiple are configured.
 */
async function matchInputByFallback(
  dbCtx: TriageDbContext,
  inputs: any[],
  workspaceId: string,
  integrationId: string | undefined,
) {
  logger.info('[Notion Webhook] No workspace ID match, checking for unambiguous fallback...')

  // Find all inputs with tokens and active flows
  const inputsWithTokens: Array<{ input: any; flow: any }> = []

  for (const input of inputs) {
    const hasToken = input.sourceMetadata?.notionToken || input.apiToken
    if (hasToken) {
      const flow = await loadActiveFlow(dbCtx, input.flowId)
      if (flow) {
        inputsWithTokens.push({ input, flow })
      }
    }
  }

  if (inputsWithTokens.length === 1) {
    // Unambiguous - only one option
    const { input, flow } = inputsWithTokens[0]!
    logger.info('[Notion Webhook] Matched input by unambiguous fallback (single input with token)', {
      inputId: input.id,
      inputSourceType: input.sourceType,
    })
    return { matchedInput: input, matchedFlow: flow }
  }

  if (inputsWithTokens.length > 1) {
    // Multiple inputs found - try to match by integration_id if stored
    for (const { input, flow } of inputsWithTokens) {
      if (input.sourceMetadata?.notionIntegrationId === integrationId) {
        logger.info('[Notion Webhook] Matched input by integration ID', {
          inputId: input.id,
          integrationId,
        })
        return { matchedInput: input, matchedFlow: flow }
      }
    }

    // Still no match - use first one with warning (for development/testing)
    logger.warn('[Notion Webhook] Multiple Notion inputs found, using first one (configure workspace/integration ID for precise matching)', {
      workspaceId,
      integrationId,
      inputCount: inputsWithTokens.length,
      inputIds: inputsWithTokens.map(i => i.input.id),
      selectedInput: inputsWithTokens[0]!.input.id,
    })
    return { matchedInput: inputsWithTokens[0]!.input, matchedFlow: inputsWithTokens[0]!.flow }
  }

  return null
}

/**
 * Find the active flow input matching this webhook: query active Notion
 * inputs, match by workspace ID, then fall back to unambiguous/integration-ID
 * matching. Returns the input count for the not-found log.
 */
async function findMatchingFlowInput(
  dbCtx: TriageDbContext,
  workspaceId: string,
  integrationId: string | undefined,
) {
  const { db, triageInputs, eq, and } = dbCtx

  // Query for Notion inputs
  const inputs = await db
    .select()
    .from(triageInputs)
    .where(and(
      eq(triageInputs.sourceType, 'notion'),
      eq(triageInputs.active, true),
    ))
    .all()

  // Find matching input by workspace ID (stored in sourceMetadata)
  // Fallback: if no workspace ID stored, match any active Notion input with a valid token
  const match = await matchInputByWorkspace(dbCtx, inputs, workspaceId)
    || await matchInputByFallback(dbCtx, inputs, workspaceId, integrationId)

  return {
    matchedInput: match?.matchedInput,
    matchedFlow: match?.matchedFlow,
    inputCount: inputs.length,
  }
}

/**
 * Auto-capture workspace/integration IDs onto the matched input's
 * sourceMetadata if not already stored (updates the DB row and the local
 * reference). This enables user mapping to work for Notion inputs.
 */
async function autoCaptureSourceIds(
  dbCtx: TriageDbContext,
  matchedInput: any,
  workspaceId: string,
  integrationId: string | undefined,
) {
  const needsWorkspaceUpdate = !matchedInput.sourceMetadata?.notionWorkspaceId && workspaceId !== 'unknown'
  const needsIntegrationUpdate = !matchedInput.sourceMetadata?.notionIntegrationId && integrationId

  if (!(needsWorkspaceUpdate || needsIntegrationUpdate)) {
    return
  }

  logger.info('[Notion Webhook] Auto-capturing workspace/integration IDs', {
    inputId: matchedInput.id,
    workspaceId: needsWorkspaceUpdate ? workspaceId : 'already set',
    integrationId: needsIntegrationUpdate ? integrationId : 'already set',
  })

  const updatedMetadata = {
    ...matchedInput.sourceMetadata,
    ...(needsWorkspaceUpdate && { notionWorkspaceId: workspaceId }),
    ...(needsIntegrationUpdate && { notionIntegrationId: integrationId }),
  }

  const { db, triageInputs, eq } = dbCtx
  await db
    .update(triageInputs)
    .set({
      sourceMetadata: updatedMetadata,
      updatedAt: new Date(),
    })
    .where(eq(triageInputs.id, matchedInput.id))

  // Update local reference for this request
  matchedInput.sourceMetadata = updatedMetadata

  logger.info('[Notion Webhook] Workspace/integration IDs captured successfully')
}

/**
 * Resolve the input's API token, fetch the comment content, and check it for
 * the configured trigger keyword. Returns the token on trigger, or the
 * response to send otherwise.
 */
async function fetchCommentAndCheckTrigger(matchedInput: any, commentId: string, parentId: string) {
  // Get API token from flow input (can be in apiToken or sourceMetadata.notionToken)
  const apiToken = matchedInput.apiToken || matchedInput.sourceMetadata?.notionToken
  if (!apiToken) {
    logger.warn('[Notion Webhook] No API token configured for input', {
      inputId: matchedInput.id,
      hasApiToken: !!matchedInput.apiToken,
      hasSourceMetadataToken: !!matchedInput.sourceMetadata?.notionToken,
    })
    return { ok: false as const, response: { success: false, message: 'No API token configured' } }
  }

  logger.info('[Notion Webhook] Using API token from input', {
    inputId: matchedInput.id,
    tokenSource: matchedInput.apiToken ? 'apiToken' : 'sourceMetadata.notionToken',
  })

  // Fetch the comment to get its content
  const comment = await fetchComment(commentId, apiToken)
  if (!comment) {
    logger.warn('[Notion Webhook] Failed to fetch comment', {
      commentId,
      parentId,
    })
    return { ok: false as const, response: { success: false, message: 'Failed to fetch comment content' } }
  }

  // Check for trigger keyword
  const triggerKeyword = matchedInput.sourceMetadata?.triggerKeyword || DEFAULT_TRIGGER_KEYWORD
  logger.info('[Notion Webhook] Checking for trigger keyword', {
    triggerKeyword,
    commentTextPreview: comment.rich_text?.map((r: any) => r.plain_text).join('').substring(0, 100),
  })
  const hasTrigger = checkForTrigger(comment.rich_text, triggerKeyword)

  if (!hasTrigger) {
    logger.info('[Notion Webhook] No trigger keyword found in comment', {
      commentId,
      triggerKeyword,
    })
    return {
      ok: false as const,
      response: { success: true, message: `Comment does not contain trigger keyword '${triggerKeyword}'` },
    }
  }

  logger.info('[Notion Webhook] Trigger keyword found - processing comment', {
    commentId,
    triggerKeyword,
  })

  return { ok: true as const, apiToken }
}

/**
 * Parse the webhook event with the Notion adapter into a ParsedDiscussion,
 * overriding the teamId with the matched flow's team and recording the
 * workspace ID for flow lookup in the processor.
 */
async function parseNotionEvent(
  body: NotionWebhookPayload,
  matchedInput: any,
  matchedFlow: any,
  apiToken: string,
  workspaceId: string,
) {
  const adapter = getAdapter('notion')

  // Build a minimal config for parsing
  const sourceConfig = {
    id: matchedInput.id,
    teamId: matchedFlow.teamId,
    sourceType: 'notion' as const,
    apiToken,
    sourceMetadata: matchedInput.sourceMetadata,
  }

  try {
    const parsed = await (adapter as any).parseIncoming(body, sourceConfig)

    // Override teamId with the actual team from the matched flow
    // (the adapter returns workspace_id which is not the correct team ID)
    parsed.teamId = matchedFlow.teamId

    // Add workspace ID to metadata for flow lookup in processor
    parsed.metadata = {
      ...parsed.metadata,
      notionWorkspaceId: workspaceId,
    }

    logger.info('[Notion Webhook] Successfully parsed event', {
      sourceThreadId: parsed.sourceThreadId,
      teamId: parsed.teamId,
      title: parsed.title,
      authorHandle: parsed.authorHandle,
    })

    return { ok: true as const, parsed }
  }
  catch (parseError: any) {
    logger.error('[Notion Webhook] Failed to parse event', parseError)
    return {
      ok: false as const,
      response: { success: false, message: 'Failed to parse event', error: parseError.message },
    }
  }
}

/**
 * Emit the webhook:received telemetry hook (fire-and-forget).
 */
function emitWebhookReceivedTelemetry(correlationId: any, rawBody: string, parsed: any) {
  const notionContentHash = rawBody.length.toString(16) + '-' + (rawBody.charCodeAt(0) || 0).toString(16)
  useNitroApp().hooks.callHook('crouton:operation', {
    type: 'webhook:received',
    source: 'crouton-triage',
    correlationId,
    metadata: {
      source: 'notion',
      threadId: parsed.sourceThreadId,
      contentHash: notionContentHash,
    },
  }).catch(() => {})
}

/**
 * Production path: queue discussion processing in the background via
 * Cloudflare's waitUntil and acknowledge immediately.
 */
function dispatchBackgroundProcessing(cfCtx: any, parsed: any, correlationId: any) {
  // Production: Process in background using waitUntil
  logger.debug('[Notion Webhook] Using background processing (waitUntil)')

  cfCtx.waitUntil(
    processDiscussion(parsed, { correlationId })
      .then((result) => {
        logger.debug('[Notion Webhook] Background processing completed', {
          discussionId: result.discussionId,
          taskCount: result.notionTasks.length,
          processingTime: `${result.processingTime}ms`,
          isMultiTask: result.isMultiTask,
        })
      })
      .catch((error) => {
        logger.error('[Notion Webhook] Background processing failed', error)
      }),
  )

  // Return immediately
  return {
    success: true,
    message: 'Discussion queued for background processing',
    timestamp: new Date().toISOString(),
  }
}

/**
 * Development path: process the discussion synchronously to see errors
 * properly, returning the full result (or a 200 error body to prevent
 * Notion retries).
 */
async function processDiscussionSynchronously(event: any, parsed: any, cfCtx: any, isDevMode: boolean) {
  // Development: Process synchronously to see errors properly
  logger.info('[Notion Webhook] Using synchronous processing', {
    isDevMode,
    hasCloudflareCtx: !!cfCtx,
  })

  let result: ProcessingResult

  try {
    result = await processDiscussion(parsed, { correlationId: (event.context as any).correlationId })

    logger.debug('[Notion Webhook] Discussion processed successfully', {
      discussionId: result.discussionId,
      taskCount: result.notionTasks.length,
      processingTime: `${result.processingTime}ms`,
      isMultiTask: result.isMultiTask,
    })
  }
  catch (processingError: any) {
    logger.error('[Notion Webhook] Processing failed', processingError)

    // Return 200 even on errors to prevent Notion retries
    // The error is logged for debugging
    return {
      success: false,
      message: 'Processing failed',
      error: processingError.message,
      timestamp: new Date().toISOString(),
    }
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

export default defineEventHandler(async (event: any) => {
  logger.debug('[Notion Webhook] REQUEST RECEIVED', { method: event.method, path: event.path })

  try {
    // Read raw body (for signature verification) + parse payload
    const payload = await readAndParseWebhookBody(event)
    if (!payload.ok) {
      return payload.response
    }
    const { rawBody, body } = payload

    // Handle URL verification challenge
    const challenge = resolveVerificationChallenge(body)
    if (challenge) {
      return challenge
    }

    // Verify webhook signature
    const signatureFailure = enforceSignatureGate(event, rawBody)
    if (signatureFailure) {
      return signatureFailure
    }

    // Validate timestamp (replay attack prevention)
    if (!validateTimestamp(body.timestamp)) {
      return { success: false, message: 'Request timestamp outside tolerance window' }
    }

    // Rate limiting
    const workspaceId = body.workspace_id || 'unknown'
    if (!checkRateLimit(workspaceId)) {
      // Return 429 for rate limiting
      setResponseStatus(event, 429)
      return { success: false, message: 'Rate limit exceeded' }
    }

    // Validate event type
    if (body.type !== 'comment.created') {
      logger.debug('[Notion Webhook] Ignoring non-comment event', { type: body.type })
      return {
        success: true,
        message: `Event type '${body.type}' ignored (only 'comment.created' is processed)`,
      }
    }

    // Validate payload structure
    const commentEvent = extractCommentEvent(body, workspaceId)
    if (!commentEvent.ok) {
      return commentEvent.response
    }
    const { commentId, parentId, integrationId } = commentEvent

    // Find the flow input for this workspace (source of the API token)
    const dbCtx = await loadTriageDb()
    const { matchedInput, matchedFlow, inputCount } = await findMatchingFlowInput(dbCtx, workspaceId, integrationId)

    if (!matchedInput || !matchedFlow) {
      logger.warn('[Notion Webhook] No active flow found for workspace', {
        workspaceId,
        availableInputs: inputCount,
      })
      // Return 200 to prevent retries
      return {
        success: false,
        message: `No active flow configured for workspace: ${workspaceId}`,
      }
    }

    logger.debug('[Notion Webhook] Found matching flow', {
      flowId: matchedFlow.id,
      flowName: matchedFlow.name,
      inputId: matchedInput.id,
    })

    await autoCaptureSourceIds(dbCtx, matchedInput, workspaceId, integrationId)

    // Fetch comment content and check for the trigger keyword
    const trigger = await fetchCommentAndCheckTrigger(matchedInput, commentId, parentId)
    if (!trigger.ok) {
      return trigger.response
    }

    // Parse event with the Notion adapter
    const parseResult = await parseNotionEvent(body, matchedInput, matchedFlow, trigger.apiToken, workspaceId)
    if (!parseResult.ok) {
      return parseResult.response
    }
    const { parsed } = parseResult

    // Emit webhook:received telemetry
    const notionCorrelationId = (event.context as any).correlationId
    emitWebhookReceivedTelemetry(notionCorrelationId, rawBody, parsed)

    // Process discussion — background (waitUntil) in production, synchronous in dev
    logger.debug('[Notion Webhook] Starting discussion processing...')

    const cfCtx = (event.context as any).cloudflare?.context
    const isDevMode = import.meta.dev

    if (cfCtx && !isDevMode) {
      return dispatchBackgroundProcessing(cfCtx, parsed, notionCorrelationId)
    }

    return await processDiscussionSynchronously(event, parsed, cfCtx, isDevMode)
  }
  catch (error) {
    // Log the error but return 200 to prevent Notion retries
    logger.error('[Notion Webhook] Unexpected error', error, { stack: (error as Error).stack })

    return {
      success: false,
      message: 'Internal server error',
      error: (error as Error).message,
      timestamp: new Date().toISOString(),
    }
  }
})
