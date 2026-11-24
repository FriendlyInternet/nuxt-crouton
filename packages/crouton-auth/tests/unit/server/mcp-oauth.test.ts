// @vitest-environment node
/**
 * Sign-in for Claude / MCP apps (#4096) — against REAL better-auth + SQLite.
 *
 * The database is built from the shipped `server/database/schema/auth.ts`
 * (drizzle-kit/api), with foreign keys ON like D1, so the tests run on the
 * real columns and references, not a hand copy. Requests go through
 * `auth.handler` from the exported `createAuth()`. Only `nitropack/runtime`
 * is mocked (email hooks), as in rate-limit.test.ts.
 *
 * T1  flag off → no OAuth plugins and the OAuth routes answer 404;
 *     flag on → jwt + mcp (scopes offline_access + pages, open DCR), no cimd.
 * T3  discovery JSON (authorization/token/registration/jwks, resource <base>/mcp).
 * T10 10 registrations per minute per IP; the 11th is refused (429).
 * T11 a registration deletes anonymous, never-used clients older than 24 h,
 *     and keeps used, revoked-with-tokens, young and admin-owned ones.
 * Rule: a token for Claude carries no team (authorization-code + PKCE run).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createHash, randomBytes } from 'node:crypto'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { generateSQLiteDrizzleJson, generateSQLiteMigration } from 'drizzle-kit/api'
import { decodeJwt } from 'jose'
import * as authSchema from '../../../server/database/schema/auth'
import { createAuth, buildMcpOAuthOptions } from '../../../server/lib/auth'
import { cleanupStaleMcpClients, mcpDiscoveryRoute, STALE_CLIENT_AGE_MS } from '../../../server/lib/mcp-oauth'
import fr from '../../../i18n/locales/fr.json'

vi.mock('nitropack/runtime', () => ({
  useNitroApp: () => ({ hooks: { callHook: vi.fn().mockResolvedValue(undefined) } })
}))

const ORIGIN = 'http://localhost:3000'
const CALLBACK = 'https://claude.example/cb'
type Auth = ReturnType<typeof createAuth>

let schemaSql: string[]
let sqlite: Database.Database

async function freshDb() {
  if (!schemaSql) {
    const tables = Object.fromEntries(Object.entries(authSchema).filter(([, v]) => v && typeof v === 'object' && Symbol.for('drizzle:Name') in (v as object)))
    const empty = await generateSQLiteDrizzleJson({})
    const full = await generateSQLiteDrizzleJson(tables)
    schemaSql = await generateSQLiteMigration(empty, full)
  }
  sqlite = new Database(':memory:')
  sqlite.pragma('foreign_keys = ON')
  for (const stmt of schemaSql) sqlite.exec(stmt)
}

function instance(mcpOAuth: boolean): Auth {
  const db = drizzle(sqlite, { schema: authSchema })
  return createAuth({
    config: { mcpOAuth, methods: { password: true } } as never,
    db: db as never,
    secret: 'test-secret-test-secret-test-secret-123',
    baseURL: ORIGIN,
    schema: authSchema
  })
}

const pluginIds = (auth: Auth) => ((auth.options.plugins ?? []) as { id: string }[]).map(p => p.id)

async function register(auth: Auth, opts: { ip?: string, name?: string, redirect?: string } = {}) {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (opts.ip) headers['cf-connecting-ip'] = opts.ip
  // No cookie and no Origin, the way Claude registers.
  return auth.handler(new Request(`${ORIGIN}/api/auth/oauth2/register`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      client_name: opts.name ?? 'Claude',
      redirect_uris: [opts.redirect ?? 'https://claude.example/cb'],
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code']
    })
  }))
}

describe('MCP sign-in (#4096)', () => {
  beforeEach(async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    await freshDb()
  })
  afterEach(async () => {
    // better-auth finishes some writes (rate-limit counters) after the response.
    await new Promise(resolve => setTimeout(resolve, 50))
    sqlite.close()
    vi.restoreAllMocks()
  })

  describe('T1 — the flag', () => {
    it('off: no jwt / oauth-provider plugin, and the OAuth routes answer 404', async () => {
      const auth = instance(false)
      expect(pluginIds(auth)).not.toContain('jwt')
      expect(pluginIds(auth)).not.toContain('oauth-provider')
      expect((await register(auth)).status).toBe(404)
      const meta = await auth.handler(new Request(`${ORIGIN}/.well-known/oauth-authorization-server/api/auth`))
      expect(meta.status).toBe(404)
      const pr = await auth.handler(new Request(`${ORIGIN}/.well-known/oauth-protected-resource/mcp`))
      expect(pr.status).toBe(404)
    })

    it('on: jwt + one provider + cleanup hook, no cimd, scopes offline_access + pages, open DCR', () => {
      const ids = pluginIds(instance(true))
      expect(ids).toContain('jwt')
      expect(ids.filter(id => id === 'oauth-provider')).toHaveLength(1)
      expect(ids).toContain('crouton-mcp-client-cleanup')
      expect(ids.some(id => id.includes('cimd'))).toBe(false)
      const opts = buildMcpOAuthOptions(`${ORIGIN}/`)
      expect(opts.resource).toBe(`${ORIGIN}/mcp`)
      expect(opts.scopes).toEqual(['offline_access', 'pages'])
      expect(opts.allowDynamicClientRegistration).toBe(true)
      expect(opts.allowUnauthenticatedClientRegistration).toBe(true)
      expect(opts.loginPage).toBe('/auth/login')
      expect(opts.consentPage).toBe('/auth/consent')
    })
  })

  describe('T3 — discovery', () => {
    it('the middleware answers exactly the four root paths (openid-configuration is not ours)', () => {
      expect(mcpDiscoveryRoute('/.well-known/oauth-authorization-server')).toBe('metadata')
      expect(mcpDiscoveryRoute('/.well-known/oauth-authorization-server/api/auth')).toBe('handler')
      expect(mcpDiscoveryRoute('/.well-known/oauth-protected-resource')).toBe('handler')
      expect(mcpDiscoveryRoute('/.well-known/oauth-protected-resource/mcp')).toBe('handler')
      expect(mcpDiscoveryRoute('/.well-known/openid-configuration')).toBeNull()
      expect(mcpDiscoveryRoute('/mcp')).toBeNull()
    })

    it('flag on: auth-server metadata names the endpoints, protected resource names <base>/mcp', async () => {
      const auth = instance(true)
      const meta = await auth.handler(new Request(`${ORIGIN}/.well-known/oauth-authorization-server/api/auth`))
      expect(meta.status).toBe(200)
      const m = await meta.json() as Record<string, unknown>
      for (const key of ['authorization_endpoint', 'token_endpoint', 'registration_endpoint', 'jwks_uri']) {
        expect(m[key], key).toBeTruthy()
      }
      for (const path of ['/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/mcp']) {
        const res = await auth.handler(new Request(`${ORIGIN}${path}`))
        expect(res.status, path).toBe(200)
        expect(((await res.json()) as { resource?: string }).resource, path).toBe(`${ORIGIN}/mcp`)
      }
    })
  })

  describe('T10 — registration limit', () => {
    it('10 per minute per IP get through, the 11th is 429, another IP still gets in', async () => {
      const auth = instance(true)
      const statuses: number[] = []
      for (let i = 0; i < 11; i++) statuses.push((await register(auth, { ip: '203.0.113.7' })).status)
      expect(statuses.slice(0, 10).every(s => s !== 429)).toBe(true)
      expect(statuses.slice(0, 10).every(s => s < 300)).toBe(true)
      expect(statuses[10]).toBe(429)
      expect((await register(auth, { ip: '198.51.100.9' })).status).not.toBe(429)
    })
  })

  describe('T11 — stale-client cleanup', () => {
    const HOUR = 60 * 60 * 1000
    it('the stale-client cutoff is 24 h', () => {
      expect(STALE_CLIENT_AGE_MS).toBe(24 * HOUR)
    })
    // One hour past the cutoff (25 h old).
    const old = () => new Date(Date.now() - STALE_CLIENT_AGE_MS - HOUR).getTime() / 1000 | 0
    const insertClient = (clientId: string, createdAt: number, userId: string | null = null) =>
      sqlite.prepare('insert into oauthClient (id, clientId, redirectUris, createdAt, userId) values (?, ?, ?, ?, ?)')
        .run(`row-${clientId}`, clientId, '["https://claude.example/cb"]', createdAt, userId)
    const insertUser = (id: string) =>
      sqlite.prepare('insert into user (id, name, email, emailVerified, createdAt, updatedAt) values (?, ?, ?, 0, ?, ?)')
        .run(id, id, `${id}@example.com`, 0, 0)
    const clientIds = () => (sqlite.prepare('select clientId from oauthClient order by clientId').all() as { clientId: string }[]).map(r => r.clientId)

    it('a registration deletes only anonymous, unused clients older than 24 h', async () => {
      insertUser('u1')
      insertClient('stale-a', old())
      insertClient('stale-b', old())
      insertClient('consented', old())
      sqlite.prepare('insert into oauthConsent (id, clientId, userId, scopes, createdAt, updatedAt) values (?, ?, ?, ?, ?, ?)')
        .run('c1', 'consented', 'u1', '["pages"]', old(), old())
      // Revoked: the consent row is gone, the tokens stay (Révoquer deletes only the consent).
      insertClient('revoked', old())
      sqlite.prepare('insert into oauthRefreshToken (id, token, clientId, userId, expiresAt, createdAt, scopes) values (?, ?, ?, ?, ?, ?, ?)')
        .run('r1', 'rt', 'revoked', 'u1', old() + 999999, old(), '["pages"]')
      sqlite.prepare('insert into oauthAccessToken (id, token, clientId, userId, refreshId, expiresAt, createdAt, scopes) values (?, ?, ?, ?, ?, ?, ?, ?)')
        .run('a1', 'at', 'revoked', 'u1', 'r1', old() + 3600, old(), '["pages"]')
      insertClient('young', (Date.now() - 60 * 60 * 1000) / 1000 | 0)
      insertClient('admin-owned', old(), 'u1')

      const auth = instance(true)
      const res = await register(auth)
      expect(res.status).toBeLessThan(300)
      const created = ((await res.json()) as { client_id: string }).client_id

      const left = clientIds()
      expect(left).not.toContain('stale-a')
      expect(left).not.toContain('stale-b')
      for (const kept of ['consented', 'revoked', 'young', 'admin-owned', created]) expect(left).toContain(kept)
      expect((sqlite.prepare('select count(*) n from oauthAccessToken').get() as { n: number }).n).toBe(1)
    })

    it('one failing delete does not stop the others', async () => {
      const deleted: string[] = []
      const adapter = {
        findMany: async ({ model }: { model: string }) => model === 'oauthClient'
          ? [{ clientId: 'x' }, { clientId: 'y' }]
          : [],
        delete: async ({ where }: { where: { value: unknown }[] }) => {
          if (where[0]!.value === 'x') throw new Error('boom')
          deleted.push(where[0]!.value as string)
        }
      }
      expect(await cleanupStaleMcpClients(adapter as never, new Date())).toEqual(['y'])
      expect(deleted).toEqual(['y'])
    })
  })

  describe('rule — the token names the user and the scopes, no team', () => {
    it('authorization code + PKCE after Autoriser: sub = user, aud = <base>/mcp, pages, refresh works, no team claim', async () => {
      const auth = instance(true)
      // A user in two teams.
      const signUp = await auth.api.signUpEmail({ body: { email: 'maker@example.com', password: 'a-long-password-123', name: 'Maker' }, asResponse: true })
      const cookie = signUp.headers.getSetCookie().map(c => c.split(';')[0]).join('; ')
      const userId = ((await signUp.json()) as { user: { id: string } }).user.id
      for (const slug of ['team-a', 'team-b']) {
        await auth.api.createOrganization({ body: { name: slug, slug }, headers: new Headers({ cookie }) })
      }

      const reg = await register(auth, { redirect: CALLBACK })
      const regBody = await reg.json() as { client_id: string }
      expect(reg.status, JSON.stringify(regBody)).toBeLessThan(300)
      const clientId = regBody.client_id

      const verifier = randomBytes(32).toString('base64url')
      const challenge = createHash('sha256').update(verifier).digest('base64url')
      const authorize = new URL(`${ORIGIN}/api/auth/oauth2/authorize`)
      authorize.search = new URLSearchParams({
        response_type: 'code', client_id: clientId, redirect_uri: CALLBACK,
        scope: 'pages offline_access', state: 's1', code_challenge: challenge, code_challenge_method: 'S256',
        resource: `${ORIGIN}/mcp`
      }).toString()
      const toConsent = await auth.handler(new Request(authorize, { headers: { cookie }, redirect: 'manual' }))
      const consentUrl = new URL(toConsent.headers.get('location')!, ORIGIN)
      expect(consentUrl.pathname, consentUrl.search).toBe('/auth/consent')

      const consent = await auth.handler(new Request(`${ORIGIN}/api/auth/oauth2/consent`, {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json', origin: ORIGIN },
        body: JSON.stringify({ accept: true, oauth_query: consentUrl.search.slice(1) })
      }))
      expect(consent.status).toBe(200)
      const back = new URL(((await consent.json()) as { url: string }).url)
      expect(back.origin + back.pathname).toBe(CALLBACK)
      const code = back.searchParams.get('code')!
      expect(code).toBeTruthy()

      const token = await auth.handler(new Request(`${ORIGIN}/api/auth/oauth2/token`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code', code, redirect_uri: CALLBACK,
          client_id: clientId, code_verifier: verifier, resource: `${ORIGIN}/mcp`
        })
      }))
      expect(token.status).toBe(200)
      const tokens = await token.json() as { access_token: string, refresh_token?: string }
      const claims = decodeJwt(tokens.access_token)
      expect(claims.sub).toBe(userId)
      expect([claims.aud].flat()).toContain(`${ORIGIN}/mcp`)
      expect(String(claims.scope)).toContain('pages')
      expect(Object.keys(claims).filter(k => /team|org/i.test(k))).toEqual([])
      expect(tokens.refresh_token).toBeTruthy()

      const refreshed = await auth.handler(new Request(`${ORIGIN}/api/auth/oauth2/token`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token!, client_id: clientId, resource: `${ORIGIN}/mcp` })
      }))
      expect(refreshed.status).toBe(200)
      expect(((await refreshed.json()) as { access_token?: string }).access_token).toBeTruthy()
    })
  })

  it('the French consent copy', () => {
    expect(fr.auth.consent.title).toBe('{client} veut accéder à vos équipes')
    expect(fr.auth.consent.unnamedClient).toBe('Une application')
    expect(fr.auth.consent.allow).toBe('Autoriser')
    expect(fr.auth.consent.deny).toBe('Refuser')
    expect(fr.auth.consent.scopes.pages).toBe('lire et modifier vos pages en direct — sans enregistrer')
  })
})
