// @vitest-environment node
/**
 * Email verification, password reset and the invite round-trip (#3138 R1, R6)
 *
 * Drives the REAL better-auth through the production `createAuth()`; only the storage
 * is swapped for better-auth's in-memory adapter and the mailer hook is captured.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { memoryAdapter } from 'better-auth/adapters/memory'
import { createAuth } from '../../../server/lib/auth'

let store: Record<string, any[]>
const hookCalls: any[] = []

vi.mock('better-auth/adapters/drizzle', () => ({
  drizzleAdapter: () => (opts: any) => memoryAdapter(store)(opts)
}))
vi.mock('nitropack/runtime', () => ({
  useNitroApp: () => ({ hooks: { callHook: async (_n: string, payload: any) => { hookCalls.push(payload) } } })
}))

const BASE = 'https://app.example.com'

function make(emailInstalled: boolean) {
  return createAuth({
    config: {} as any,
    db: { all: async () => [] } as never,
    secret: 'x'.repeat(40),
    baseURL: BASE,
    emailInstalled
  }) as any
}

const json = (body: unknown) => ({
  method: 'POST',
  headers: { 'content-type': 'application/json', origin: BASE },
  body: JSON.stringify(body)
})
const call = (auth: any, path: string, body: unknown) =>
  auth.handler(new Request(`${BASE}/api/auth${path}`, json(body)))

beforeEach(() => {
  store = { user: [], session: [], account: [], verification: [], rateLimit: [] }
  hookCalls.length = 0
})

describe('R1 — verification required only where crouton-email is installed', () => {
  it('with email: sign-up creates no session and unverified sign-in is refused; verified works', async () => {
    const auth = make(true)
    const up = await call(auth, '/sign-up/email', { email: 'a@example.com', password: 'password123', name: 'A' })
    expect((await up.json()).token).toBeNull()

    const refused = await call(auth, '/sign-in/email', { email: 'a@example.com', password: 'password123' })
    expect(refused.status).toBe(403)

    store.user![0].emailVerified = true
    const ok = await call(auth, '/sign-in/email', { email: 'a@example.com', password: 'password123' })
    expect(ok.status).toBe(200)
  })

  it('without email: sign-up returns a session as today', async () => {
    const auth = make(false)
    const up = await call(auth, '/sign-up/email', { email: 'b@example.com', password: 'password123', name: 'B' })
    expect(typeof (await up.json()).token).toBe('string')
  })

  it('a password reset ends the other open sessions', async () => {
    const auth = make(false)
    await call(auth, '/sign-up/email', { email: 'c@example.com', password: 'password123', name: 'C' })
    await call(auth, '/sign-in/email', { email: 'c@example.com', password: 'password123' })
    expect(store.session!.length).toBeGreaterThan(1)

    await call(auth, '/request-password-reset', { email: 'c@example.com', redirectTo: '/reset' })
    const reset = hookCalls.find(h => h.type === 'password-reset')
    const token = new URL(reset.url).pathname.split('/').pop()
    const res = await call(auth, '/reset-password', { token, newPassword: 'newpassword123' })
    expect(res.status).toBe(200)
    expect(store.session).toHaveLength(0)
  })
})

describe('R6 — the invitee lands back on the invite page, signed in', () => {
  it('verify link carries the invite page and creates a session', async () => {
    const auth = make(true)
    await call(auth, '/sign-up/email', {
      email: 'i@example.com', password: 'password123', name: 'I',
      callbackURL: '/auth/accept-invitation/abc'
    })
    const mail = hookCalls.find(h => h.type === 'verification')
    expect(mail).toBeTruthy()
    const res = await auth.handler(new Request(mail.url, { redirect: 'manual', headers: { origin: BASE } }))
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('/auth/accept-invitation/abc')
    expect(res.headers.get('set-cookie') ?? '').toContain('session_token')
  })
})

describe('backfill migration', () => {
  it('marks existing users verified and nobody else changes', async () => {
    const { DatabaseSync } = (await import('node:module')).createRequire(import.meta.url)('node:sqlite')
    const { readFileSync, readdirSync } = await import('node:fs')
    const dir = new URL('../../../../../apps/velo/server/db/migrations/sqlite/', import.meta.url)
    const file = readdirSync(dir).find(f => f.endsWith('_verify_existing_users.sql'))!
    const d = new DatabaseSync(':memory:')
    d.exec('CREATE TABLE `user` (`id` text, `emailVerified` integer NOT NULL DEFAULT 0);')
    d.exec("INSERT INTO `user` VALUES ('u1', 0), ('u2', 1);")
    d.exec(readFileSync(new URL(file, dir), 'utf8'))
    expect(d.prepare('SELECT COUNT(*) AS n FROM `user` WHERE `emailVerified` = 0').get().n).toBe(0)
  })
})
