/**
 * Sign-in access for the page tools at `/mcp` (#4097).
 *
 * Claude signs in through crouton-auth's MCP OAuth (#4096) and sends the access
 * token as `Authorization: Bearer …`. This checks it, in-process:
 *
 * 1. a JWT signed with the app's own keys (`auth.api.getJwks()` — no HTTP),
 *    issued by `<origin>/api/auth` for the audience `<origin>/mcp`;
 * 2. not DPoP-bound (`cnf.jkt` → refused; the provider issues none today);
 * 3. carries the `pages` scope (else 403 `insufficient_scope`);
 * 4. its consent row (client + user) still exists — a revoked connection loses
 *    access on its next request, even while the JWT has not expired.
 *
 * The token names a user, never a team: the team is a tool argument, checked
 * per call (see `tools.ts`). Every failure carries a `WWW-Authenticate`
 * challenge so Claude knows where to sign in again.
 */
import type { H3Event } from 'h3'
import { APIError } from 'better-auth/api'
import { createInsufficientScopeError, verifyJwsAccessToken } from 'better-auth/oauth2'
import { createResourceServerChallenge } from '@better-auth/oauth-provider'
import type { JSONWebKeySet } from 'jose'

export interface PagesAccess {
  userId: string
  /** The consent row id: one per (client, user), stable across token refreshes. */
  tokenId: string
}

export interface SignInDeps {
  /** The app's base URL, no trailing slash; the resource is `${origin}/mcp`. */
  origin: string
  /** The token issuer: `(await auth.$context).baseURL` → `<origin>/api/auth`. */
  issuer: string
  /** The signing keys: `() => auth.api.getJwks()`. */
  jwks: () => Promise<JSONWebKeySet>
  /** The consent row for this client + user, or null once revoked. */
  findConsent: (clientId: string, userId: string) => Promise<{ id: string } | null>
}

const PAGES_SCOPE = 'pages'
const CHALLENGE_SCOPES = [PAGES_SCOPE, 'offline_access'] as const

/** One stable key so the JWKS is cached between requests (same rules as a URL source). */
const JWKS_CACHE_KEY = {}

/**
 * What the middleware needs from a failure. Structural on purpose: better-auth's
 * `APIError` and better-call's (what the oauth2 helpers return) are two classes.
 */
export interface SignInError {
  statusCode: number
  message: string
  headers?: unknown
}

export type SignInResult =
  | { data: PagesAccess, error: null }
  | { data: null, error: SignInError }

function unauthorized(message: string): SignInError {
  return new APIError('UNAUTHORIZED', { message })
}

/** The error with its `WWW-Authenticate` challenge (falls back to the raw error). */
function challenge(error: SignInError, origin: string): SignInError {
  return createResourceServerChallenge(error, `${origin}/mcp`, { challengeScopes: CHALLENGE_SCOPES }) ?? error
}

function bearerToken(request: Request): string | null {
  const header = request.headers.get('authorization')
  if (!header || !/^bearer /i.test(header)) return null
  return header.slice(7).trim() || null
}

export async function resolveSignInAccess(request: Request, deps: SignInDeps): Promise<SignInResult> {
  const fail = (error: SignInError): SignInResult => ({ data: null, error: challenge(error, deps.origin) })

  const token = bearerToken(request)
  if (!token) return fail(unauthorized('sign in required'))

  let payload: Awaited<ReturnType<typeof verifyJwsAccessToken>>
  try {
    payload = await verifyJwsAccessToken(token, {
      jwksFetch: deps.jwks,
      jwksCacheKey: JWKS_CACHE_KEY,
      verifyOptions: { audience: `${deps.origin}/mcp`, issuer: deps.issuer }
    })
  } catch (error) {
    return fail(unauthorized(`invalid access token: ${error instanceof Error ? error.message : 'verification failed'}`))
  }

  const cnf = payload.cnf as { jkt?: unknown } | undefined
  if (cnf?.jkt) return fail(unauthorized('DPoP-bound tokens are not accepted'))

  const scopes = typeof payload.scope === 'string' ? payload.scope.split(' ').filter(Boolean) : []
  if (!scopes.includes(PAGES_SCOPE)) return fail(createInsufficientScopeError([PAGES_SCOPE]))

  const userId = typeof payload.sub === 'string' ? payload.sub : null
  const clientId = typeof payload.azp === 'string'
    ? payload.azp
    : typeof payload.client_id === 'string' ? payload.client_id : null
  if (!userId || !clientId) return fail(unauthorized('access token names no user or client'))

  const consent = await deps.findConsent(clientId, userId)
  if (!consent) return fail(unauthorized('this connection was revoked: sign in again'))

  return { data: { userId, tokenId: consent.id }, error: null }
}

interface AuthContextLike {
  baseURL: string
  options: { baseURL?: unknown }
  adapter: {
    findOne: <T>(query: { model: string, where: Array<{ field: string, value: string }> }) => Promise<T | null>
  }
}

/** The real deps, from crouton-auth's better-auth instance. */
export async function signInDeps(event: H3Event): Promise<SignInDeps> {
  const { useServerAuth } = await import('@fyit/crouton-auth/server/utils/useServerAuth')
  const auth = useServerAuth(event) as unknown as {
    $context: Promise<AuthContextLike>
    api: { getJwks: () => Promise<JSONWebKeySet> }
  }
  const ctx = await auth.$context
  const base = typeof ctx.options.baseURL === 'string' ? ctx.options.baseURL : ''
  return {
    origin: base.endsWith('/') ? base.slice(0, -1) : base,
    issuer: ctx.baseURL,
    jwks: () => auth.api.getJwks(),
    findConsent: async (clientId, userId) => {
      const row = await ctx.adapter.findOne<{ id: string }>({
        model: 'oauthConsent',
        where: [{ field: 'clientId', value: clientId }, { field: 'userId', value: userId }]
      })
      return row ? { id: row.id } : null
    }
  }
}
