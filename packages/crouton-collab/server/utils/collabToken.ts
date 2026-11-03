/**
 * Collab token sign/verify (#2693). Shared by `/api/collab/token` (sign, in the app) and
 * `CollabRoom` (verify, in the collab Worker) so the two can't drift. Dependency-free on
 * purpose — the Worker bundles this file directly.
 *
 * Token = base64(JSON {userId, teamId, room, exp}).base64(HMAC-SHA256). Keyed by COLLAB_TOKEN_SECRET, a
 * dedicated value set identically on the app and the Worker; there is deliberately no
 * fallback to BETTER_AUTH_SECRET.
 */

const enc = new TextEncoder()

const hmacKey = (secret: string, usage: 'sign' | 'verify') =>
  crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [usage])

export interface CollabTokenClaims {
  userId: string
  teamId: string
  /** Full room key, `${teamId}:${roomType}:${roomId}` */
  room: string
}

export async function signCollabToken(claims: CollabTokenClaims, secret: string | undefined, ttlMs = 60_000): Promise<string> {
  if (!secret) throw new Error('COLLAB_TOKEN_SECRET is not set')
  const payload = JSON.stringify({ userId: claims.userId, teamId: claims.teamId, room: claims.room, exp: Date.now() + ttlMs })
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(secret, 'sign'), enc.encode(payload))
  return `${btoa(payload)}.${btoa(String.fromCharCode(...new Uint8Array(sig)))}`
}

/** The claims on success; null when the token is malformed, forged, expired, or no secret is set. */
export async function verifyCollabToken(token: string, secret: string | undefined): Promise<CollabTokenClaims | null> {
  if (!secret) return null
  const [payloadB64, signatureB64] = token.split('.')
  if (!payloadB64 || !signatureB64) return null
  try {
    const payload = atob(payloadB64)
    const sigBytes = Uint8Array.from(atob(signatureB64), c => c.charCodeAt(0))
    const valid = await crypto.subtle.verify('HMAC', await hmacKey(secret, 'verify'), sigBytes, enc.encode(payload))
    if (!valid) return null
    const data = JSON.parse(payload) as { userId?: string, teamId?: string, room?: string, exp: number }
    if (Date.now() > data.exp) return null
    if (!data.userId || !data.teamId || !data.room) return null
    return { userId: data.userId, teamId: data.teamId, room: data.room }
  } catch {
    return null
  }
}

/**
 * The userId when the token is valid for exactly this room and the room belongs to the
 * token's team; null otherwise. A request without claims is never authorized.
 */
export function authorizeRoomRequest(claims: CollabTokenClaims | null, roomKey: string | null | undefined): string | null {
  if (!claims || !roomKey) return null
  if (claims.room !== roomKey) return null
  if (!roomKey.startsWith(`${claims.teamId}:`)) return null
  return claims.userId
}

/** Split a room key `${teamId}:${roomType}:${roomId}` into its parts. */
export function parseRoomKey(roomKey: string): { teamId: string, roomType: string, roomId: string } | null {
  const a = roomKey.indexOf(':')
  const b = roomKey.indexOf(':', a + 1)
  if (a <= 0 || b <= a + 1 || b === roomKey.length - 1) return null
  return { teamId: roomKey.slice(0, a), roomType: roomKey.slice(a + 1, b), roomId: roomKey.slice(b + 1) }
}
