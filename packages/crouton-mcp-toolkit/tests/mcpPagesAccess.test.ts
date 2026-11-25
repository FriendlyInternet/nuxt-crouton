/**
 * #4097 — the sign-in check for the page tools at `/mcp`, the generic tools'
 * token check, and the token mint endpoint.
 *
 * - resolveSignInAccess: real better-auth verification (`verifyJwsAccessToken`)
 *   and the real `createResourceServerChallenge`, on JWTs signed here with
 *   `jose` and served through the injected `jwks` — so the signature, issuer,
 *   audience, scope and consent checks all really run. The consent lookup is
 *   injected (its real form, `adapter.findOne('oauthConsent')`, was run against
 *   real better-auth while planning #4097; it needs crouton-auth's DB).
 * - requireMcpAuth (the generic tools' check): accepts only `mcp-toolkit` tokens.
 * - POST /api/teams/:id/mcp-tokens: always a member `mcp-toolkit` token.
 *
 * crouton-auth's DB-backed helpers are mocked: they need a live D1/SQLite with the
 * scoped-token table, which this package's unit run has no way to boot. The
 * mocks mirror their contracts (validateScopedToken → the row or null).
 */
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest'
import { SignJWT, exportJWK, generateKeyPair, type JSONWebKeySet, type JWTPayload } from 'jose'

const h = vi.hoisted(() => {
  const g = globalThis as any
  g.defineEventHandler = (fn: any) => fn
  g.createError = (err: any) => Object.assign(new Error(err?.statusText || err?.message || 'error'), err)
  g.getHeader = (event: any, name: string) => event?.headers?.[name]
  g.readBody = async (event: any) => event?.__body
  g.getRequestURL = () => new URL('https://velo.test/api/teams/team_A/mcp-tokens')
  return {
    tokens: {} as Record<string, any>,
    created: [] as any[]
  }
})

vi.mock('@fyit/crouton-auth/server/utils/scoped-access', () => ({
  validateScopedToken: async (token: string) => h.tokens[token] ?? null,
  createScopedToken: async (opts: any) => {
    h.created.push(opts)
    return { token: 'new-token', id: 'tok_new', expiresAt: new Date('2027-01-01T00:00:00Z') }
  }
}))

vi.mock('@fyit/crouton-auth/server/utils/team', () => ({
  resolveTeamAndCheckMembership: async () => ({ team: { id: 'team_A' }, user: { id: 'u1' }, membership: { role: 'member' } }),
  requireTeamAdmin: async () => { throw new Error('the mint endpoint must not ask for admin any more') }
}))

import { resolveSignInAccess, type SignInDeps } from '../server/mcp-pages/lib/auth'
import { requireMcpAuth } from '../server/utils/mcp-auth'
import mintHandler from '../server/api/teams/[id]/mcp-tokens/index.post'

const ORIGIN = 'https://velo.test'
const ISSUER = `${ORIGIN}/api/auth`
const KID = 'test-key'

let privateKey: CryptoKey
let jwks: JSONWebKeySet

beforeAll(async () => {
  const pair = await generateKeyPair('RS256')
  privateKey = pair.privateKey
  jwks = { keys: [{ ...(await exportJWK(pair.publicKey)), kid: KID, alg: 'RS256', use: 'sig' }] }
})

/** A real-shaped access token (claims as #4096's flow issues them). */
async function accessToken(overrides: JWTPayload = {}): Promise<string> {
  const claims: JWTPayload = {
    sub: 'user_1',
    aud: `${ORIGIN}/mcp`,
    azp: 'client_1',
    client_id: 'client_1',
    scope: 'pages offline_access',
    iss: ISSUER,
    ...overrides
  }
  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'RS256', kid: KID })
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(privateKey)
}

/** Consent rows keyed `client:user`. */
let consents: Record<string, { id: string }>

function deps(): SignInDeps {
  return {
    origin: ORIGIN,
    issuer: ISSUER,
    jwks: async () => jwks,
    findConsent: vi.fn(async (clientId: string, userId: string) => consents[`${clientId}:${userId}`] ?? null)
  }
}

const bearer = (token?: string) => new Request(`${ORIGIN}/mcp`, {
  method: 'POST',
  headers: token ? { authorization: `Bearer ${token}` } : {}
})

const CHALLENGE = `Bearer resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource/mcp", scope="pages offline_access"`

function expect401(result: Awaited<ReturnType<typeof resolveSignInAccess>>) {
  expect(result.data).toBeNull()
  expect(result.error?.statusCode).toBe(401)
  expect((result.error?.headers as Record<string, string>)['WWW-Authenticate']).toBe(CHALLENGE)
}

beforeEach(() => {
  consents = {
    'client_1:user_1': { id: 'consent_1' },
    'client_1:user_2': { id: 'consent_2' }
  }
  h.tokens = {
    general: { id: 'tok_g', organizationId: 'team_A', resourceType: 'mcp', resourceId: 'mcp-toolkit', role: 'member' },
    oldPages: { id: 'tok_p', organizationId: 'team_A', resourceType: 'mcp', resourceId: 'mcp-pages', role: 'admin' }
  }
  h.created = []
})

describe('resolveSignInAccess', () => {
  // covers: T1
  it('no Bearer token → 401 with the resource_metadata + scope challenge', async () => {
    expect401(await resolveSignInAccess(bearer(), deps()))
  })

  // covers: T1
  it('a ?token= query is not read: still 401', async () => {
    const token = await accessToken()
    expect401(await resolveSignInAccess(new Request(`${ORIGIN}/mcp?token=${token}`), deps()))
  })

  // covers: T2
  it('a valid token with its consent row → the user and the consent id', async () => {
    const d = deps()
    const result = await resolveSignInAccess(bearer(await accessToken()), d)
    expect(result).toEqual({ data: { userId: 'user_1', tokenId: 'consent_1' }, error: null })
    expect(d.findConsent).toHaveBeenCalledWith('client_1', 'user_1')
  })

  // covers: T4
  it('a token for another audience (<origin>/mcp/pages) → 401 with the challenge', async () => {
    expect401(await resolveSignInAccess(bearer(await accessToken({ aud: `${ORIGIN}/mcp/pages` })), deps()))
  })

  // covers: T15
  it('a token issued by the bare origin (not <origin>/api/auth) → 401', async () => {
    expect401(await resolveSignInAccess(bearer(await accessToken({ iss: ORIGIN })), deps()))
  })

  // covers: T15
  it('a token signed with another key → 401', async () => {
    const other = await generateKeyPair('RS256')
    const forged = await new SignJWT({ sub: 'user_1', aud: `${ORIGIN}/mcp`, azp: 'client_1', scope: 'pages', iss: ISSUER })
      .setProtectedHeader({ alg: 'RS256', kid: KID })
      .setExpirationTime('1h')
      .sign(other.privateKey)
    expect401(await resolveSignInAccess(bearer(forged), deps()))
  })

  // covers: T5
  it('revoked: a valid token whose consent row is gone → 401 with the challenge', async () => {
    consents = {}
    expect401(await resolveSignInAccess(bearer(await accessToken()), deps()))
  })

  // covers: T8
  it('two users of the same client get two different token ids', async () => {
    const one = await resolveSignInAccess(bearer(await accessToken({ sub: 'user_1' })), deps())
    const two = await resolveSignInAccess(bearer(await accessToken({ sub: 'user_2' })), deps())
    expect(one.data?.tokenId).toBe('consent_1')
    expect(two.data?.tokenId).toBe('consent_2')
  })

  // covers: T11
  it('a token without the pages scope → 403 insufficient_scope', async () => {
    const d = deps()
    const result = await resolveSignInAccess(bearer(await accessToken({ scope: 'offline_access' })), d)
    expect(result.data).toBeNull()
    expect(result.error?.statusCode).toBe(403)
    const header = (result.error?.headers as Record<string, string>)['WWW-Authenticate']
    expect(header).toContain('error="insufficient_scope"')
    expect(header).toContain('scope="pages"')
    expect(header).toContain(`resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource/mcp"`)
    expect(d.findConsent).not.toHaveBeenCalled()
  })

  // covers: T11
  it('a DPoP-bound token (cnf.jkt) → 401', async () => {
    const result = await resolveSignInAccess(bearer(await accessToken({ cnf: { jkt: 'thumbprint' } })), deps())
    expect(result.data).toBeNull()
    expect(result.error?.statusCode).toBe(401)
  })
})

describe('requireMcpAuth (generic tools)', () => {
  const event = (token: string) => ({ headers: { authorization: `Bearer ${token}` } }) as any

  // covers: T7
  it('refuses a non-general MCP token (the old mcp-pages kind) with 403', async () => {
    await expect(requireMcpAuth(event('oldPages'), 'team_A')).rejects.toMatchObject({ status: 403, statusText: 'Token is not a general MCP token' })
  })

  // covers: T7
  it('still accepts a general mcp-toolkit token for its own team', async () => {
    await expect(requireMcpAuth(event('general'), 'team_A')).resolves.toMatchObject({ id: 'tok_g' })
    await expect(requireMcpAuth(event('general'), 'team_B')).rejects.toMatchObject({ status: 403 })
  })
})

describe('POST /api/teams/:id/mcp-tokens', () => {
  const post = (body: any) => (mintHandler as any)({ __body: body })

  // covers: T7
  it('a body asking for the old pages scope still mints a member mcp-toolkit token, no url', async () => {
    const res = await post({ scope: 'pages' })
    expect(h.created).toHaveLength(1)
    expect(h.created[0]).toMatchObject({ organizationId: 'team_A', resourceType: 'mcp', resourceId: 'mcp-toolkit', role: 'member', displayName: 'MCP Client' })
    expect(res).toMatchObject({ token: 'new-token', teamId: 'team_A' })
    expect(res.url).toBeUndefined()
  })

  // covers: T7
  it('the default body mints a member mcp-toolkit token (no url)', async () => {
    const res = await post({})
    expect(h.created[0]).toMatchObject({ resourceId: 'mcp-toolkit', role: 'member' })
    expect(res.url).toBeUndefined()
  })
})
