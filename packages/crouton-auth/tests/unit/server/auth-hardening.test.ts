// @vitest-environment node
/**
 * Sign-in hardening (#3141) — drives the REAL `createAuth` (real better-auth,
 * in-memory adapter) rather than the private config builders, so each case
 * proves what a user actually experiences: sign-up, sign-in, reset, verify link.
 *
 * Its own file on purpose: auth-lib.test.ts mocks `better-auth` for the whole
 * file, which would turn every case here into a test of the mock.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { memoryAdapter } from 'better-auth/adapters/memory'
import { createAuth, isEmailVerificationRequired } from '../../../server/lib/auth'

type Sent = { type: string, to: string, url: string }

const { db, sent } = vi.hoisted(() => ({
  db: {} as Record<string, any[]>,
  sent: [] as Sent[]
}))

vi.mock('better-auth/adapters/drizzle', () => ({
  drizzleAdapter: () => memoryAdapter(db)
}))

vi.mock('nitropack/runtime', () => ({
  useNitroApp: () => ({
    hooks: {
      callHook: async (_name: string, payload: Sent) => {
        sent.push(payload)
      }
    }
  })
}))

const EMAIL = 'new.user@example.com'
const PASSWORD = 'correct-horse-battery'

function build(requireEmailVerification: boolean) {
  return createAuth({
    config: {} as any,
    db: { all: async () => [], run: async () => ({}), get: async () => undefined } as any,
    secret: 'y'.repeat(40),
    baseURL: 'http://localhost:3000',
    requireEmailVerification
  }) as any
}

async function signUp(auth: any, body: Record<string, unknown> = {}) {
  return auth.api.signUpEmail({ body: { email: EMAIL, password: PASSWORD, name: 'New User', ...body } })
}

async function signIn(auth: any) {
  return auth.api.signInEmail({ body: { email: EMAIL, password: PASSWORD } })
}

beforeEach(() => {
  for (const key of Object.keys(db)) delete db[key]
  Object.assign(db, {
    user: [], session: [], account: [], verification: [],
    organization: [], member: [], invitation: [], passkey: [], twoFactor: []
  })
  sent.length = 0
})

describe('createAuth sign-in hardening (#3141)', () => {
  it('with crouton-email: sign-up gives no session and sends a verification e-mail', async () => {
    const auth = build(true)
    const res = await signUp(auth)
    expect(res.token).toBeNull()
    expect(sent.filter(s => s.type === 'verification')).toHaveLength(1)
  })

  it('with crouton-email: an unverified account cannot sign in', async () => {
    const auth = build(true)
    await signUp(auth)
    let error: any
    try {
      await signIn(auth)
    } catch (e) {
      error = e
    }
    expect(error).toBeDefined()
    expect(error.statusCode).toBe(403)
    expect(error.body?.code).toBe('EMAIL_NOT_VERIFIED')
  })

  it('with crouton-email: a verified account can sign in', async () => {
    const auth = build(true)
    await signUp(auth)
    db.user[0].emailVerified = true
    const res = await signIn(auth)
    expect(typeof res.token).toBe('string')
  })

  it('without crouton-email: sign-up signs you in, as today', async () => {
    const auth = build(false)
    const res = await signUp(auth)
    expect(typeof res.token).toBe('string')
    expect(sent.filter(s => s.type === 'verification')).toHaveLength(0)
    expect(db.user[0].emailVerified).toBe(false)
    const signedIn = await signIn(auth)
    expect(typeof signedIn.token).toBe('string')
  })

  for (const requireEmailVerification of [true, false]) {
    it(`a password reset signs out every session (requireEmailVerification: ${requireEmailVerification})`, async () => {
      const auth = build(requireEmailVerification)
      await signUp(auth)
      db.user[0].emailVerified = true
      await signIn(auth)
      await signIn(auth)
      expect(db.session.length).toBeGreaterThanOrEqual(2)

      await auth.api.requestPasswordReset({ body: { email: EMAIL, redirectTo: '/auth/reset-password' } })
      const mail = sent.find(s => s.type === 'password-reset')
      expect(mail).toBeDefined()
      const token = new URL(mail!.url).pathname.split('/').pop()!

      await auth.api.resetPassword({ body: { token, newPassword: 'another-long-password' } })
      expect(db.session).toHaveLength(0)
    })
  }

  it('the verify link returns to the page the user came from, signed in', async () => {
    const auth = build(true)
    await signUp(auth, { callbackURL: '/auth/accept-invitation/inv1' })
    const mail = sent.find(s => s.type === 'verification')
    expect(mail).toBeDefined()

    const res: Response = await auth.handler(new Request(mail!.url))
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('/auth/accept-invitation/inv1')
    expect(res.headers.get('set-cookie') ?? '').toMatch(/session_token=/)
  })

  it('isEmailVerificationRequired reads only crouton-email\'s key', () => {
    expect(isEmailVerificationRequired({ public: { crouton: { email: { brand: {} } } } })).toBe(true)
    expect(isEmailVerificationRequired({ public: { crouton: { auth: {} } } })).toBe(false)
    expect(isEmailVerificationRequired({})).toBe(false)
    expect(isEmailVerificationRequired({ public: { croutonBookings: { email: {} } } })).toBe(false)
  })
})
