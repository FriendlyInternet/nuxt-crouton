// @vitest-environment node
/**
 * T10 + T11 (#4096) — open client registration is limited and cleaned up.
 *
 * Real better-auth + SQLite (foreign keys ON, like D1), requests through the
 * real `POST /api/auth/oauth2/register` handler, so the provider's rate limit,
 * crouton's per-`cf-connecting-ip` rule and the after-register cleanup hook all
 * run as they do in the app.
 *
 * T10 10 registrations per minute from one IP get through, the 11th is 429,
 *     another IP still gets in.
 * T11 after a registration: an anonymous client 25 h old with no consent and
 *     no tokens is gone; one with a consent stays; one whose consent was
 *     revoked but which still has an access + refresh token stays (no throw,
 *     and a fourth stale unused client in the same batch is still deleted);
 *     one 1 h old stays; one with a userId stays.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type Database from 'better-sqlite3'
import { freshDb, instance, register } from './mcp-oauth-harness'

vi.mock('nitropack/runtime', () => ({
  useNitroApp: () => ({ hooks: { callHook: vi.fn().mockResolvedValue(undefined) } })
}))

let sqlite: Database.Database

beforeEach(async () => {
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  sqlite = await freshDb()
})
afterEach(async () => {
  // better-auth finishes some writes (rate-limit counters) after the response.
  await new Promise(resolve => setTimeout(resolve, 50))
  sqlite.close()
  vi.restoreAllMocks()
})

describe('T10 — registration rate limit (#4096)', () => {
  it('10 registrations from one cf-connecting-ip pass, the 11th is 429, another IP still passes', async () => {
    const auth = instance(sqlite, true)
    const statuses: number[] = []
    for (let i = 0; i < 11; i++) statuses.push((await register(auth, { ip: '203.0.113.7' })).status)
    expect(statuses.slice(0, 10)).toEqual(Array(10).fill(statuses[0]))
    expect(statuses[0]).toBeLessThan(300)
    expect(statuses[10]).toBe(429)
    const other = await register(auth, { ip: '198.51.100.9' })
    expect(other.status).not.toBe(429)
    expect(other.status).toBeLessThan(300)
  })
})

describe('T11 — stale-client cleanup on registration (#4096)', () => {
  const secs = (msAgo: number) => (Date.now() - msAgo) / 1000 | 0
  const old = () => secs(25 * 60 * 60 * 1000)
  const insertUser = (id: string) =>
    sqlite.prepare('insert into user (id, name, email, emailVerified, createdAt, updatedAt) values (?, ?, ?, 0, ?, ?)')
      .run(id, id, `${id}@example.com`, 0, 0)
  const insertClient = (clientId: string, createdAt: number, userId: string | null = null) =>
    sqlite.prepare('insert into oauthClient (id, clientId, redirectUris, createdAt, userId) values (?, ?, ?, ?, ?)')
      .run(`row-${clientId}`, clientId, '["https://claude.example/cb"]', createdAt, userId)
  const clientIds = () => (sqlite.prepare('select clientId from oauthClient').all() as { clientId: string }[]).map(r => r.clientId)

  it('foreign keys are on, like D1', () => {
    expect(sqlite.pragma('foreign_keys', { simple: true })).toBe(1)
  })

  it('deletes anonymous unused clients older than 24 h and keeps consented, revoked-with-tokens, young and owned ones', async () => {
    insertUser('u1')
    insertClient('stale-unused', old())
    insertClient('consented', old())
    sqlite.prepare('insert into oauthConsent (id, clientId, userId, scopes, createdAt, updatedAt) values (?, ?, ?, ?, ?, ?)')
      .run('c1', 'consented', 'u1', '["pages"]', old(), old())
    // Revoked: the consent row was deleted (Révoquer), the tokens stay.
    insertClient('revoked', old())
    sqlite.prepare('insert into oauthConsent (id, clientId, userId, scopes, createdAt, updatedAt) values (?, ?, ?, ?, ?, ?)')
      .run('c2', 'revoked', 'u1', '["pages"]', old(), old())
    sqlite.prepare('insert into oauthRefreshToken (id, token, clientId, userId, expiresAt, createdAt, scopes) values (?, ?, ?, ?, ?, ?, ?)')
      .run('r1', 'rt', 'revoked', 'u1', old() + 999999, old(), '["pages"]')
    sqlite.prepare('insert into oauthAccessToken (id, token, clientId, userId, refreshId, expiresAt, createdAt, scopes) values (?, ?, ?, ?, ?, ?, ?, ?)')
      .run('a1', 'at', 'revoked', 'u1', 'r1', old() + 3600, old(), '["pages"]')
    sqlite.prepare('delete from oauthConsent where id = ?').run('c2')
    insertClient('stale-unused-2', old())
    insertClient('young', secs(60 * 60 * 1000))
    insertClient('owned', old(), 'u1')

    const auth = instance(sqlite, true)
    const res = await register(auth)
    expect(res.status).toBeLessThan(300)
    const created = ((await res.json()) as { client_id: string }).client_id

    const left = clientIds()
    expect(left).not.toContain('stale-unused')
    expect(left).not.toContain('stale-unused-2')
    for (const kept of ['consented', 'revoked', 'young', 'owned', created]) expect(left, kept).toContain(kept)
    // The revoked client's tokens are untouched.
    expect((sqlite.prepare('select count(*) n from oauthAccessToken').get() as { n: number }).n).toBe(1)
    expect((sqlite.prepare('select count(*) n from oauthRefreshToken').get() as { n: number }).n).toBe(1)
  })
})
