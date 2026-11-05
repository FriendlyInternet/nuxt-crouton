/**
 * POST /api/webhooks/resend
 *
 * Resend delivery callbacks (#3419). Signature-verified, translated into our
 * own states, and handed to whoever keeps an email log via the
 * `crouton:email:delivery` hook (crouton-auth's logger updates its row).
 *
 * Config: runtimeConfig.email.resendWebhookSecret (NUXT_EMAIL_RESEND_WEBHOOK_SECRET, `whsec_…`).
 */
import { translateResendEvent, verifyResendSignature } from '../../utils/delivery-events'

export default defineEventHandler(async (event) => {
  const secret = (useRuntimeConfig(event) as any).email?.resendWebhookSecret
  if (!secret) {
    throw createError({ statusCode: 503, statusMessage: 'Resend webhook secret not configured' })
  }

  const raw = await readRawBody(event, 'utf8')
  const valid = raw && await verifyResendSignature(raw, {
    id: getHeader(event, 'svix-id'),
    timestamp: getHeader(event, 'svix-timestamp'),
    signature: getHeader(event, 'svix-signature')
  }, secret)
  if (!valid) {
    throw createError({ statusCode: 401, statusMessage: 'Invalid signature' })
  }

  let body: unknown
  try {
    body = JSON.parse(raw)
  }
  catch {
    throw createError({ statusCode: 400, statusMessage: 'Invalid JSON' })
  }

  const delivery = translateResendEvent(body)
  if (!delivery) return { ok: true, ignored: true }

  await useNitroApp().hooks.callHook('crouton:email:delivery', delivery)
  return { ok: true }
})
