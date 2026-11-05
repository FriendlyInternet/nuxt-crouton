/**
 * Invite-only sign-up gate (#3340) — drives the captured
 * databaseHooks.user.create.before through createAuth().
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { CroutonAuthConfig } from '../../../types/config'
import { createAuth } from '../../../server/lib/auth'

const mockBetterAuth = vi.fn((config: unknown) => ({ config }))
const getSession = vi.fn()

vi.mock('better-auth', () => ({ betterAuth: (c: unknown) => mockBetterAuth(c) }))
vi.mock('better-auth/api', () => ({
  getSessionFromCtx: (...a: unknown[]) => getSession(...a),
  APIError: class APIError extends Error {
    constructor(public status: string, body?: { message?: string }) { super(body?.message) }
  }
}))
vi.mock('better-auth/plugins', () => ({
  organization: () => ({}), admin: () => ({}), twoFactor: () => ({}),
  magicLink: () => ({}), haveIBeenPwned: () => ({})
}))
vi.mock('@better-auth/i18n', () => ({ i18n: () => ({}) }))
vi.mock('@better-auth/passkey', () => ({ passkey: () => ({}) }))
vi.mock('better-auth/adapters/drizzle', () => ({ drizzleAdapter: () => ({}) }))
vi.mock('nitropack/runtime', () => ({
  useNitroApp: () => ({ hooks: { callHook: vi.fn().mockResolvedValue(undefined) } })
}))

function setup(config: CroutonAuthConfig, invitations: unknown[]) {
  const all = vi.fn().mockResolvedValue(invitations)
  createAuth({ config, db: { all } as never, secret: 's', baseURL: 'https://velo.pmcp.dev' })
  const built = mockBetterAuth.mock.calls.at(-1)![0] as any
  return { before: built.databaseHooks.user.create.before as (u: any, c?: any) => Promise<void>, all, built }
}

describe('signup gate', () => {
  beforeEach(() => {
    mockBetterAuth.mockClear()
    getSession.mockReset().mockResolvedValue(null)
  })

  it("'invite' without a pending invitation is refused", async () => {
    const { before } = setup({ signup: 'invite' }, [])
    await expect(before({ email: 'Stranger@x.com' }, {})).rejects.toThrow('invitation only')
  })

  it("'invite' with a pending invitation is allowed", async () => {
    const { before, all } = setup({ signup: 'invite' }, [{ id: 'inv1' }])
    await expect(before({ email: 'Invited@x.com' }, {})).resolves.toBeUndefined()
    expect(all).toHaveBeenCalledOnce()
  })

  it("'invite' lets a super admin session through", async () => {
    getSession.mockResolvedValue({ user: { superAdmin: true } })
    const { before, all } = setup({ signup: 'invite' }, [])
    await expect(before({ email: 'new@x.com' }, {})).resolves.toBeUndefined()
    expect(all).not.toHaveBeenCalled()
  })

  it("default 'open' allows anyone without querying", async () => {
    const { before, all } = setup({}, [])
    await expect(before({ email: 'anyone@x.com' }, {})).resolves.toBeUndefined()
    expect(all).not.toHaveBeenCalled()
  })

  it('invite does not force email verification before accepting', () => {
    const { built } = setup({ signup: 'invite' }, [])
    expect(JSON.stringify(built)).not.toContain('"requireEmailVerificationOnInvitation":true')
  })
})
