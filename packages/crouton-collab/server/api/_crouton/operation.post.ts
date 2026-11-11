/// <reference path="../../../crouton-hooks.d.ts" />
import { useNitroApp } from 'nitropack/runtime'
import { verifyInternalRequest } from '../../utils/internalSignature'

/**
 * Internal endpoint for Durable Object → Nitro hook bridging.
 *
 * Cloudflare Durable Objects run in a Workers-isolated environment where
 * `useNitroApp()` is not available. This endpoint accepts a POST from the DO
 * and re-emits the event into Nitro's hook system so downstream listeners
 * (e.g. crouton-events operation-listener) can persist it.
 *
 * Only the collab Worker may call it: requests must carry an HMAC over
 * `timestamp.rawBody` (x-crouton-timestamp / x-crouton-signature) keyed by
 * COLLAB_TOKEN_SECRET; anything else is a 401.
 */
export default defineEventHandler(async (event) => {
  const rawBody = (await readRawBody(event, 'utf8')) ?? ''
  const secret = process.env.COLLAB_TOKEN_SECRET
  const ok = await verifyInternalRequest(
    secret,
    getHeader(event, 'x-crouton-timestamp'),
    getHeader(event, 'x-crouton-signature'),
    rawBody
  )
  if (!ok) {
    throw createError({ status: 401, statusText: 'Unauthorized' })
  }

  let body: {
    type?: string
    source?: string
    teamId?: string
    userId?: string
    metadata?: Record<string, unknown>
  }
  try {
    body = JSON.parse(rawBody)
  } catch {
    throw createError({ status: 400, statusText: 'Invalid JSON' })
  }

  if (!body.type) {
    throw createError({ status: 400, statusText: 'Missing type' })
  }

  useNitroApp().hooks.callHook('crouton:operation', {
    type: body.type,
    source: body.source ?? 'crouton-collab',
    teamId: body.teamId,
    metadata: body.metadata,
  }).catch(() => {})

  return { ok: true }
})
