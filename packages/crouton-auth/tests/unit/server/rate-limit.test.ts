// @vitest-environment node
/**
 * Rate limit (#3138 R2) — real better-auth, the production config, two instances
 * (two Worker isolates) sharing one database-backed counter.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { memoryAdapter } from 'better-auth/adapters/memory'
import { createAuth } from '../../../server/lib/auth'

let store: Record<string, any[]>

vi.mock('better-auth/adapters/drizzle', () => ({
  drizzleAdapter: () => (opts: any) => memoryAdapter(store)(opts)
}))
vi.mock('nitropack/runtime', () => ({
  useNitroApp: () => ({ hooks: { callHook: async () => {} } })
}))

const BASE = 'https://app.example.com'
const make = () => createAuth({
  config: {} as any,
  db: { all: async () => [] } as never,
  secret: 'x'.repeat(40),
  baseURL: BASE,
  emailInstalled: false
}) as any

function hit(auth: any, path: string, ip?: string) {
  return auth.handler(new Request(`${BASE}/api/auth${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: BASE, ...(ip && { 'cf-connecting-ip': ip }) },
    body: JSON.stringify({ email: 'nobody@example.com', password: 'wrongpassword1' })
  })).then((r: Response) => r.status)
}

beforeEach(() => {
  store = { user: [], session: [], account: [], verification: [], rateLimit: [] }
})

describe('rate limit', () => {
  it('429s the 4th sign-in within 10s from one IP', async () => {
    const auth = make()
    const statuses = []
    for (let i = 0; i < 4; i++) statuses.push(await hit(auth, '/sign-in/email', '1.1.1.1'))
    expect(statuses.slice(0, 3).every(s => s !== 429)).toBe(true)
    expect(statuses[3]).toBe(429)
  })

  it('429s the 4th password-reset and the 4th verification email (60s window)', async () => {
    const auth = make()
    for (const path of ['/request-password-reset', '/send-verification-email']) {
      const statuses = []
      for (let i = 0; i < 4; i++) statuses.push(await hit(auth, path, '2.2.2.2'))
      expect(statuses[3], path).toBe(429)
    }
  })

  it('counts across instances (one shared counter) and per IP', async () => {
    const a = make()
    const b = make()
    const s = [
      await hit(a, '/sign-in/email', '3.3.3.3'),
      await hit(b, '/sign-in/email', '3.3.3.3'),
      await hit(a, '/sign-in/email', '3.3.3.3'),
      await hit(b, '/sign-in/email', '3.3.3.3')
    ]
    expect(s[3]).toBe(429)
    expect(await hit(a, '/sign-in/email', '4.4.4.4')).not.toBe(429)
  })

  it('never throttles (or records) requests with no client IP', async () => {
    const auth = make()
    for (const path of ['/sign-in/email', '/get-session']) {
      for (let i = 0; i < 6; i++) expect(await hit(auth, path), path).not.toBe(429)
    }
    expect(store.rateLimit).toHaveLength(0)
  })

  it('loosens nothing: no custom rule sets its own window or max', () => {
    const auth = make()
    const rl = auth.options.rateLimit
    expect(rl.storage).toBe('database')
    expect(rl.window).toBeUndefined()
    expect(rl.max).toBeUndefined()
    for (const rule of Object.values(rl.customRules ?? {})) expect(typeof rule).toBe('function')
  })
})
