import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createError } from 'h3'

// Drives the REAL handler (server/api/editor/token.get.ts) with Nitro globals stubbed and a fake
// session. Guards "only the owner can mint an editor token" (#3261): delete the owner check and
// the not-the-owner case below fails.

const OWNER = 'owner@example.test'
const RETURN = 'https://diagram.pmcp.dev/?slug=a&branch=b'
let sessionEmail: string | null
let redirects: Array<{ to: string, code: number }>

async function run(query: Record<string, unknown>) {
  vi.resetModules()
  redirects = []
  vi.stubGlobal('defineEventHandler', (h: unknown) => h)
  vi.stubGlobal('setHeader', () => {})
  vi.stubGlobal('createError', createError)
  vi.stubGlobal('getQuery', () => query)
  vi.stubGlobal('sendRedirect', (_e: unknown, to: string, code: number) => { redirects.push({ to, code }); return to })
  vi.stubGlobal('useRuntimeConfig', () => ({ statusOwnerEmail: OWNER, reviewSeedSecret: 'seed' }))
  vi.stubGlobal('useServerAuth', () => ({
    api: { getSession: async () => (sessionEmail ? { user: { email: sessionEmail } } : null) }
  }))
  const handler = (await import('../server/api/editor/token.get')).default as unknown as (e: unknown) => Promise<unknown>
  return handler({ headers: new Headers() }).then(() => 200, (e: any) => e.statusCode as number)
}

beforeEach(() => { sessionEmail = null })
afterEach(() => { vi.unstubAllGlobals() })

describe('GET /api/editor/token', () => {
  it('signed out -> redirect to sign-in, no token', async () => {
    expect(await run({ return: RETURN })).toBe(200)
    expect(redirects).toHaveLength(1)
    expect(redirects[0].to.startsWith('/signin?redirect=')).toBe(true)
    expect(redirects[0].to).not.toContain('owner=')
  })

  it('signed in as someone other than the owner -> 401, no token', async () => {
    sessionEmail = 'someone-else@example.test'
    expect(await run({ return: RETURN })).toBe(401)
    expect(redirects).toHaveLength(0)
  })

  it('signed in as the owner -> redirect back with a token (case-insensitive email)', async () => {
    sessionEmail = OWNER.toUpperCase()
    expect(await run({ return: RETURN })).toBe(200)
    expect(redirects).toHaveLength(1)
    expect(redirects[0].to).toMatch(/^https:\/\/diagram\.pmcp\.dev\/\?slug=a&branch=b#owner=[\w-]+\.[\w-]+$/)
  })

  it('return link outside the allowlist -> 400, no token, even for the owner', async () => {
    sessionEmail = OWNER
    for (const bad of ['https://evil.example/', 'https://diagram.pmcp.dev.evil.example/', '//x', undefined]) {
      expect(await run({ return: bad })).toBe(400)
    }
    expect(redirects).toHaveLength(0)
  })
})
