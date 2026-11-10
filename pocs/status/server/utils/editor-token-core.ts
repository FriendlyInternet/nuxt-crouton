// Owner token for the ticket-editor worker (#3261). Pure + WebCrypto so it is unit-testable.
// Format and verifier live in workers/ticket-editor/src/guard.ts — keep in sync.

export const EDITOR_ORIGIN = 'https://diagram.pmcp.dev'
export const EDITOR_TOKEN_TTL_S = 10 * 60

function b64url(bytes: Uint8Array): string {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

// The worker's HMAC key, derived from the review seed exactly as deploy-ticket-editor.yml does:
// sha256("<seed>:ticket-editor:owner-token") as lowercase hex.
export async function deriveEditorSecret(seed: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${seed}:ticket-editor:owner-token`))
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('')
}

export async function signEditorToken(secret: string, nowMs: number): Promise<string> {
  const payload = b64url(new TextEncoder().encode(JSON.stringify({ aud: 'ticket-editor', exp: Math.floor(nowMs / 1000) + EDITOR_TOKEN_TTL_S })))
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload))
  return `${payload}.${b64url(new Uint8Array(sig))}`
}

// `return` must be an https URL on exactly the editor origin (no open redirect). Returns the
// normalised URL without any fragment, or null.
export function safeEditorReturn(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw || raw.length > 2000) return null
  try {
    const u = new URL(raw)
    if (u.origin !== EDITOR_ORIGIN) return null
    u.hash = ''
    return u.toString()
  } catch {
    return null
  }
}
