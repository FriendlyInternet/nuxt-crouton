/**
 * Save guards for the ticket-editor (#3261) — pure functions so they run in plain Node tests.
 *
 *  - verifyOwnerToken: the status app mints a short-lived HMAC token for the signed-in owner;
 *    the worker only accepts saves that carry it.
 *  - branchAllowed:   refuse the repo's default branch and any protected branch (read from GitHub).
 *  - issueAllowed:    refuse a handoff comment on anything that is not a real issue in the repo.
 *
 * Every check fails closed: an unexpected response or a network error means "refuse".
 * Keep the token format in sync with pocs/status/server/utils/editor-token-core.ts.
 */

export const TOKEN_AUD = 'ticket-editor'
export const MAX_TOKEN_LIFETIME_S = 15 * 60

type Fetch = (url: string, init?: RequestInit) => Promise<Response>

function fromB64url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

export async function verifyOwnerToken(token: string, secret: string, nowMs: number): Promise<boolean> {
  try {
    if (!secret || !token || token.length > 2048) return false
    const parts = token.split('.')
    if (parts.length !== 2 || !parts[0] || !parts[1]) return false
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify'])
    const ok = await crypto.subtle.verify('HMAC', key, fromB64url(parts[1]), new TextEncoder().encode(parts[0]))
    if (!ok) return false
    const payload = JSON.parse(new TextDecoder().decode(fromB64url(parts[0]))) as { aud?: string; iat?: number; exp?: number }
    if (payload.aud !== TOKEN_AUD || typeof payload.exp !== 'number') return false
    const now = Math.floor(nowMs / 1000)
    if (payload.exp <= now) return false
    if (payload.exp - now > MAX_TOKEN_LIFETIME_S) return false
    return true
  } catch {
    return false
  }
}

function ghHeaders(token: string): Record<string, string> {
  return { authorization: 'Bearer ' + token, accept: 'application/vnd.github+json', 'user-agent': 'ticket-editor' }
}

export async function branchAllowed(fetchImpl: Fetch, token: string, repo: string, branch: string): Promise<boolean> {
  try {
    if (!/^[A-Za-z0-9._/-]+$/.test(branch) || branch.includes('..')) return false
    const repoRes = await fetchImpl('https://api.github.com/repos/' + repo, { headers: ghHeaders(token) })
    if (!repoRes.ok) return false
    const def = ((await repoRes.json()) as { default_branch?: string }).default_branch
    if (!def || branch === def) return false
    const brRes = await fetchImpl('https://api.github.com/repos/' + repo + '/branches/' + branch.split('/').map(encodeURIComponent).join('/'), { headers: ghHeaders(token) })
    if (!brRes.ok) return false
    const info = (await brRes.json()) as { protected?: boolean }
    return info.protected === false
  } catch {
    return false
  }
}

export async function issueAllowed(fetchImpl: Fetch, token: string, repo: string, issue: number): Promise<boolean> {
  try {
    if (!Number.isInteger(issue) || issue <= 0) return false
    const res = await fetchImpl('https://api.github.com/repos/' + repo + '/issues/' + issue, { headers: ghHeaders(token) })
    if (res.status !== 200) return false
    const body = (await res.json()) as Record<string, unknown>
    return !('pull_request' in body)
  } catch {
    return false
  }
}
