/**
 * Logout Scoped Access Token
 *
 * POST /api/auth/scoped-access/logout
 *
 * Revokes a scoped access token AND clears the httpOnly `scoped-access-token`
 * cookie. Both halves matter for SSR to re-gate:
 *  - The cookie is httpOnly, so client JS can never clear it — only a
 *    Set-Cookie from the server can. Without this the next SSR request would
 *    keep presenting a live cookie and gated pages would still render.
 *  - The token is read from the body OR the cookie, so logout works even when
 *    the client lost its in-memory session but the cookie is still set.
 */
import { revokeScopedToken } from '../../../utils/scoped-access'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ token?: string }>(event).catch(() => ({} as { token?: string }))
  // Prefer an explicit token; fall back to the cookie so a logout with no body
  // (or a stale client) still revokes whatever the browser would send to SSR.
  const token = body?.token || getCookie(event, 'scoped-access-token')

  const revoked = token ? await revokeScopedToken(token) : false

  // Clear the httpOnly cookie regardless — the next SSR request must not carry
  // a token. Path must match the redeem Set-Cookie (path: '/').
  deleteCookie(event, 'scoped-access-token', { path: '/' })

  return { success: revoked }
})
