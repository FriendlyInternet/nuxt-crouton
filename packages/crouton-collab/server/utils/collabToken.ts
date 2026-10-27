/**
 * Collab token sign/verify (#2693). Shared by `/api/collab/token` (sign, in the app) and
 * `CollabRoom` (verify, in the collab Worker) so the two can't drift. Dependency-free on
 * purpose — the Worker bundles this file directly.
 *
 * Token = base64(JSON {userId, exp}).base64(HMAC-SHA256). Keyed by COLLAB_TOKEN_SECRET, a
 * dedicated value set identically on the app and the Worker; there is deliberately no
 * fallback to BETTER_AUTH_SECRET.
 */

const enc = new TextEncoder()

const hmacKey = (secret: string, usage: 'sign' | 'verify') =>
  crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [usage])

export async function signCollabToken(userId: string, secret: string | undefined, ttlMs = 60_000): Promise<string> {
  if (!secret) throw new Error('COLLAB_TOKEN_SECRET is not set')
  const payload = JSON.stringify({ userId, exp: Date.now() + ttlMs })
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(secret, 'sign'), enc.encode(payload))
  return `${btoa(payload)}.${btoa(String.fromCharCode(...new Uint8Array(sig)))}`
}

/** The userId on success; null when the token is malformed, forged, expired, or no secret is set. */
export async function verifyCollabToken(token: string, secret: string | undefined): Promise<string | null> {
  if (!secret) return null
  const [payloadB64, signatureB64] = token.split('.')
  if (!payloadB64 || !signatureB64) return null
  try {
    const payload = atob(payloadB64)
    const sigBytes = Uint8Array.from(atob(signatureB64), c => c.charCodeAt(0))
    const valid = await crypto.subtle.verify('HMAC', await hmacKey(secret, 'verify'), sigBytes, enc.encode(payload))
    if (!valid) return null
    const data = JSON.parse(payload) as { userId: string, exp: number }
    return Date.now() > data.exp ? null : data.userId
  } catch {
    return null
  }
}
