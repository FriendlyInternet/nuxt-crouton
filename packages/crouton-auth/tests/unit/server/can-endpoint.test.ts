// @vitest-environment node
/**
 * GET /api/teams/[id]/can?actions=… (#4104, T7)
 *
 * The real route handler runs inside an h3 app, on a real request carrying the
 * session cookie (what useRequestFetch() forwards during server rendering).
 * Session, team and membership come from real SQLite tables built from the
 * package's own drizzle schema; the role check is the real can() over a real
 * Better Auth instance (memory adapter). Only `nitropack/runtime` is mocked.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { generateSQLiteDrizzleJson, generateSQLiteMigration } from 'drizzle-kit/api'
import { createApp, createRouter, defineEventHandler, toWebHandler, createError } from 'h3'
import { betterAuth } from 'better-auth'
import { memoryAdapter } from 'better-auth/adapters/memory'
import { organization } from 'better-auth/plugins'
import * as authSchema from '../../../server/database/schema/auth'
import { buildOrganizationConfig, setAuthInstance } from '../../../server/lib/auth'
import { buildAccessControl, setAccessControl } from '../../../server/lib/access'

vi.mock('nitropack/runtime', () => ({
  useNitroApp: () => ({ hooks: { callHook: vi.fn().mockResolvedValue(undefined) } })
}))

const TEAM = 'team-1'
let sqlite: Database.Database
let handle: (req: Request) => Promise<Response>

async function ask(token: string, actions: string) {
  const res = await handle(new Request(`https://velo.pmcp.dev/api/teams/${TEAM}/can?actions=${actions}`, {
    headers: { cookie: `better-auth.session_token=${token}.signature` }
  }))
  return { status: res.status, body: await res.json() }
}

beforeAll(async () => {
  sqlite = new Database(':memory:')
  const { user, session, organization: org, member } = authSchema
  const ddl = await generateSQLiteMigration(
    await generateSQLiteDrizzleJson({}),
    await generateSQLiteDrizzleJson({ user, session, organization: org, member })
  )
  for (const stmt of ddl) sqlite.exec(stmt)
  const db = drizzle(sqlite, { schema: authSchema })
  vi.stubGlobal('useDB', () => db)
  vi.stubGlobal('defineEventHandler', defineEventHandler)
  vi.stubGlobal('useRuntimeConfig', () => ({ public: { crouton: { auth: { mode: 'multi-tenant' } } } }))

  const now = Date.now()
  const later = Math.floor((now + 3600_000) / 1000)
  const seconds = Math.floor(now / 1000)
  const addUser = sqlite.prepare('INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 1, ?, ?)')
  const addSession = sqlite.prepare('INSERT INTO session (id, token, userId, expiresAt, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)')
  const addMember = sqlite.prepare('INSERT INTO member (id, userId, organizationId, role, createdAt) VALUES (?, ?, ?, ?, ?)')
  sqlite.prepare('INSERT INTO organization (id, name, slug, createdAt) VALUES (?, ?, ?, ?)').run(TEAM, 'Acme', 'acme', seconds)
  for (const role of ['admin', 'member']) {
    addUser.run(`u-${role}`, role, `${role}@example.com`, seconds, seconds)
    addSession.run(`s-${role}`, `tok-${role}`, `u-${role}`, later, seconds, seconds)
    addMember.run(`m-${role}`, `u-${role}`, TEAM, role, seconds)
  }

  const access = buildAccessControl({ actions: { 'pages:edit': { label: 'permissions.pagesEdit' } } })
  setAccessControl(access)
  setAuthInstance(betterAuth({
    database: memoryAdapter({ user: [], session: [], account: [], verification: [], organization: [], member: [], invitation: [], organizationRole: [] }),
    secret: 'test-secret-test-secret-test-secret-123',
    baseURL: 'https://velo.pmcp.dev',
    plugins: [organization(buildOrganizationConfig({}, undefined, access) as never)]
  }) as never)

  const route = (await import('../../../server/api/teams/[id]/can.get')).default
  const app = createApp({
    // h3 v1 needs the status set on the node response; h3 v2 passes no `node`
    // and already answers with the error's own status.
    onError: (err, event) => {
      if (event?.node?.res) event.node.res.statusCode = (err as ReturnType<typeof createError>).statusCode ?? 500
    }
  })
  app.use(createRouter().get('/api/teams/:id/can', route))
  handle = toWebHandler(app)
})

afterAll(() => {
  sqlite.close()
  setAccessControl(null)
  vi.unstubAllGlobals()
})

describe('GET /api/teams/[id]/can (T7)', () => {
  it('answers true for an admin, false for an unknown action', async () => {
    const res = await ask('tok-admin', 'pages:edit,bogus')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ 'pages:edit': true, 'bogus': false })
  })

  it('answers false for a member', async () => {
    const res = await ask('tok-member', 'pages:edit')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ 'pages:edit': false })
  })

  it('refuses a request with no valid session cookie', async () => {
    const res = await ask('tok-nobody', 'pages:edit')
    expect(res.status).toBe(401)
  })
})
