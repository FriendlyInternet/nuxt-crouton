// @vitest-environment node
/**
 * Auth rate limiting (#3142) — behaviour against REAL better-auth + SQLite.
 *
 * The rule: a client IP (cf-connecting-ip) gets one counter, stored in the
 * shared `rateLimit` table so every Worker instance sees it, at better-auth's
 * built-in limits. A request without cf-connecting-ip is never counted, and
 * neither are the page-load session/org reads.
 *
 * No better-auth mock: requests go through `auth.handler` from the exported
 * `createAuth()`. Only `nitropack/runtime` is mocked (email hooks), as in
 * auth-config.test.ts. The DB only holds the `rateLimit` table, so a request
 * the limiter lets through fails later (400/401/500) — every case asserts only
 * 429 vs not 429.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import * as authSchema from '../../../server/database/schema/auth'
import { createAuth } from '../../../server/lib/auth'

vi.mock('nitropack/runtime', () => ({
  useNitroApp: () => ({ hooks: { callHook: vi.fn().mockResolvedValue(undefined) } })
}))

// The exact SQL of the NNNN_auth_rate_limit.sql consumer migrations.
const MIGRATION_SQL = [
  'CREATE TABLE `rateLimit` (`id` text PRIMARY KEY NOT NULL, `key` text NOT NULL, `count` integer NOT NULL, `lastRequest` integer NOT NULL);',
  'CREATE UNIQUE INDEX `rateLimit_key_unique` ON `rateLimit` (`key`);'
]

const ORIGIN = 'https://velo.pmcp.dev'

type Auth = ReturnType<typeof createAuth>

let sqlite: Database.Database
let a: Auth
let b: Auth
const env = { ...process.env }

function instance(): Auth {
  const db = drizzle(sqlite, { schema: authSchema })
  return createAuth({
    config: { methods: { password: true } } as never,
    db: db as never,
    secret: 'test-secret-test-secret-test-secret-123',
    baseURL: ORIGIN,
    schema: authSchema
  })
}

async function call(auth: Auth, path: string, ip?: string, method: 'POST' | 'GET' = 'POST'): Promise<number> {
  const headers: Record<string, string> = { 'origin': ORIGIN, 'content-type': 'application/json' }
  if (ip) headers['cf-connecting-ip'] = ip
  const body = method === 'POST'
    ? JSON.stringify({ email: 'nobody@example.com', password: 'wrong-password-123', name: 'Nobody', redirectTo: '/' })
    : undefined
  const res = await auth.handler(new Request(`${ORIGIN}/api/auth${path}`, { method, headers, body }))
  return res.status
}

async function statuses(auth: Auth, path: string, n: number, ip?: string, method: 'POST' | 'GET' = 'POST') {
  const out: number[] = []
  for (let i = 0; i < n; i++) out.push(await call(auth, path, ip, method))
  return out
}

const rows = () => sqlite.prepare('select key, count from rateLimit order by key').all() as { key: string, count: number }[]

describe('auth rate limit (#3142)', () => {
  beforeEach(() => {
    // Silence better-auth's logger noise for the requests that fail past the limiter.
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    sqlite = new Database(':memory:')
    for (const stmt of MIGRATION_SQL) sqlite.exec(stmt)
    a = instance()
    b = instance()
  })

  afterEach(() => {
    sqlite.close()
    process.env = { ...env }
    vi.restoreAllMocks()
  })

  it('blocks the 4th sign-in from one IP within 10s', async () => {
    const s = await statuses(a, '/sign-in/email', 4, '1.1.1.1')
    expect(s.slice(0, 3)).not.toContain(429)
    expect(s[3]).toBe(429)
  })

  it('blocks the 4th password-reset and verification-email request within 60s', async () => {
    for (const path of ['/request-password-reset', '/send-verification-email']) {
      const s = await statuses(a, path, 4, '1.1.1.1')
      expect(s.slice(0, 3), path).not.toContain(429)
      expect(s[3], path).toBe(429)
    }
  })

  it('shares one counter between two instances', async () => {
    const first = await statuses(a, '/sign-in/email', 3, '1.1.1.1')
    expect(first).not.toContain(429)
    expect(await call(b, '/sign-in/email', '1.1.1.1')).toBe(429)
    expect(rows()).toEqual([{ key: '1.1.1.1|/sign-in/email', count: 3 }])

    // The counter is the DB row, not process memory: clearing the table lets the IP in again.
    sqlite.exec('delete from rateLimit')
    expect(await call(b, '/sign-in/email', '1.1.1.1')).not.toBe(429)
  })

  it('counts each IP separately', async () => {
    await statuses(a, '/sign-in/email', 3, '1.1.1.1')
    expect(await call(a, '/sign-in/email', '2.2.2.2')).not.toBe(429)
  })

  it('never throttles a request without cf-connecting-ip, on a listed or unlisted path', async () => {
    for (const path of ['/sign-in/email', '/request-password-reset', '/sign-up/email']) {
      const s = await statuses(a, path, 6)
      expect(s, path).not.toContain(429)
    }
    expect(rows()).toEqual([])
  })

  it('does not count the page-load session reads', async () => {
    expect(await statuses(a, '/get-session', 105, '1.1.1.1', 'GET')).not.toContain(429)
    expect(await statuses(a, '/organization/get-full-organization', 3, '1.1.1.1', 'GET')).not.toContain(429)
    expect(await statuses(a, '/organization/list', 3, '1.1.1.1', 'GET')).not.toContain(429)
    expect(rows()).toEqual([])

    // Skipping the reads doesn't weaken the sign-in limit.
    const s = await statuses(a, '/sign-in/email', 4, '1.1.1.1')
    expect(s.slice(0, 3)).not.toContain(429)
    expect(s[3]).toBe(429)
  })
})
