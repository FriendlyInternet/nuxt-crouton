/**
 * Provider seam for email delivery confirmation (#3419).
 *
 * Resend's webhook format is translated HERE, in one place, into our own four
 * states. The email log, admin screens and status app only ever see
 * `EmailDeliveryState` — never Resend's event names or payload shape. A second
 * provider would add a sibling translator; nothing downstream changes.
 */

export type EmailDeliveryState = 'delivered' | 'bounced' | 'delayed' | 'complained'

export interface EmailDeliveryEvent {
  /** The provider's message id. */
  providerId: string
  /** First recipient address (informational; rows are matched by providerId). */
  to?: string
  state: EmailDeliveryState
  /** Short human-readable reason (bounce type etc.), if the provider gave one. */
  detail?: string
}

const RESEND_EVENT_STATES: Record<string, EmailDeliveryState> = {
  'email.delivered': 'delivered',
  'email.bounced': 'bounced',
  'email.delivery_delayed': 'delayed',
  'email.complained': 'complained'
}

/**
 * Translate a Resend webhook body into our delivery event.
 * Returns null for events we don't track (sent, opened, clicked …) or malformed bodies.
 */
export function translateResendEvent(body: unknown): EmailDeliveryEvent | null {
  if (!body || typeof body !== 'object') return null
  const { type, data } = body as { type?: unknown, data?: any }
  if (typeof type !== 'string') return null
  const state = RESEND_EVENT_STATES[type]
  const providerId = data?.email_id
  if (!state || typeof providerId !== 'string' || !providerId) return null
  const detail = data?.bounce?.message ?? data?.bounce?.type
  const to = Array.isArray(data?.to) ? data.to[0] : data?.to
  return { providerId, state, ...(typeof to === 'string' && { to }), ...(typeof detail === 'string' && { detail }) }
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/**
 * Verify a Resend (Svix-format) webhook signature with WebCrypto, so it runs on
 * Cloudflare Workers. `secret` is the `whsec_…` signing secret.
 * `tolerance` rejects stale timestamps (replay protection), in seconds.
 */
export async function verifyResendSignature(
  rawBody: string,
  headers: { id?: string | null, timestamp?: string | null, signature?: string | null },
  secret: string,
  opts: { now?: number, tolerance?: number } = {}
): Promise<boolean> {
  const { id, timestamp, signature } = headers
  if (!id || !timestamp || !signature || !secret) return false

  const now = opts.now ?? Math.floor(Date.now() / 1000)
  const ts = Number(timestamp)
  if (!Number.isFinite(ts) || Math.abs(now - ts) > (opts.tolerance ?? 300)) return false

  let keyBytes: Uint8Array
  try {
    keyBytes = base64ToBytes(secret.startsWith('whsec_') ? secret.slice(6) : secret)
  }
  catch {
    return false
  }

  const key = await crypto.subtle.importKey(
    'raw', keyBytes as BufferSource, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  )
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${id}.${timestamp}.${rawBody}`))
  const expected = btoa(String.fromCharCode(...new Uint8Array(mac)))

  // Header is space-separated "v1,<sig> v1,<sig>" (several during secret rotation).
  return signature.split(' ').some((part) => {
    const [version, sig] = part.split(',')
    return version === 'v1' && !!sig && timingSafeEqual(sig, expected)
  })
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}
