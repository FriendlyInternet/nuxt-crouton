/**
 * Shared setup for the MCP sign-in unit tests (#4096): REAL better-auth on an
 * in-memory SQLite built from the shipped `server/database/schema/auth.ts`
 * (drizzle-kit/api), with foreign keys ON like D1. Requests go through
 * `auth.handler` from the exported `createAuth()`.
 *
 * The caller mocks `nitropack/runtime` (email hooks), as rate-limit.test.ts does.
 */
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { generateSQLiteDrizzleJson, generateSQLiteMigration } from 'drizzle-kit/api'
import * as authSchema from '../../../server/database/schema/auth'
import { createAuth } from '../../../server/lib/auth'

export const ORIGIN = 'http://localhost:3000'
export type Auth = ReturnType<typeof createAuth>

let schemaSql: string[] | undefined

/** A fresh in-memory database with every auth table, foreign keys on. */
export async function freshDb(): Promise<Database.Database> {
  if (!schemaSql) {
    const tables = Object.fromEntries(Object.entries(authSchema).filter(([, v]) => v && typeof v === 'object' && Symbol.for('drizzle:Name') in (v as object)))
    const empty = await generateSQLiteDrizzleJson({})
    const full = await generateSQLiteDrizzleJson(tables)
    schemaSql = await generateSQLiteMigration(empty, full)
  }
  const sqlite = new Database(':memory:')
  sqlite.pragma('foreign_keys = ON')
  for (const stmt of schemaSql) sqlite.exec(stmt)
  return sqlite
}

/** The app's real auth instance, with the MCP sign-in flag on or off. */
export function instance(sqlite: Database.Database, mcpOAuth: boolean): Auth {
  const db = drizzle(sqlite, { schema: authSchema })
  return createAuth({
    config: { mcpOAuth, methods: { password: true } } as never,
    db: db as never,
    secret: 'test-secret-test-secret-test-secret-123',
    baseURL: ORIGIN,
    schema: authSchema
  })
}

export const pluginIds = (auth: Auth) => ((auth.options.plugins ?? []) as { id: string }[]).map(p => p.id)

/** POST /api/auth/oauth2/register with no cookie and no Origin, the way Claude registers. */
export function register(auth: Auth, opts: { ip?: string, name?: string, redirect?: string } = {}) {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (opts.ip) headers['cf-connecting-ip'] = opts.ip
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
