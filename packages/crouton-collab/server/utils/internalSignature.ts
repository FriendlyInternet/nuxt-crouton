/**
 * Request signing for the Durable Object -> app bridge (/api/_crouton/operation).
 * The signature covers `timestamp.rawBody`, so it can't be replayed for another
 * body (team/metadata) and goes stale after MAX_AGE_MS. Keyed by COLLAB_TOKEN_SECRET.
 * Dependency-free: the collab Worker bundles this file directly.
 */
const enc = new TextEncoder()
export const MAX_AGE_MS = 30_000

const hmacKey = (secret: string, usage: 'sign' | 'verify') =>
  crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [usage])

const toHex = (buf: ArrayBuffer) =>
  Array.from(new Uint8Array(buf), b => b.toString(16).padStart(2, '0')).join('')

export async function signInternalRequest(secret: string, timestamp: string, rawBody: string): Promise<string> {
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(secret, 'sign'), enc.encode(`${timestamp}.${rawBody}`))
  return toHex(sig)
}

export async function verifyInternalRequest(
  secret: string | undefined,
  timestamp: string | undefined,
  signature: string | undefined,
  rawBody: string,
  now = Date.now()
): Promise<boolean> {
  if (!secret || !timestamp || !signature) return false
  const ts = Number(timestamp)
  if (!Number.isFinite(ts) || Math.abs(now - ts) > MAX_AGE_MS) return false
  if (!/^[0-9a-f]+$/.test(signature) || signature.length % 2) return false
  try {
    const sigBytes = Uint8Array.from(signature.match(/../g) ?? [], h => parseInt(h, 16))
    return await crypto.subtle.verify('HMAC', await hmacKey(secret, 'verify'), sigBytes, enc.encode(`${timestamp}.${rawBody}`))
  } catch {
    return false
  }
}
