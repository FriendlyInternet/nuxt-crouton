// @vitest-environment node
/**
 * Invite-only sign-up (#3340) — the `signupGate` hook on a REAL better-auth.
 *
 * Unlike auth-config.test.ts (which mocks betterAuth to inspect the config),
 * this wires the exported `signupGate` into a real `betterAuth()` instance on
 * the memory adapter, with the organization + magic-link plugins, and drives
 * the browser paths through `auth.handler(new Request(...))` — the same entry
 * point the Nitro route uses. Server-side `auth.api.*` calls stand in for the
 * crouton-admin "create user" route.
 */
import { describe, it, expect, vi } from 'vitest'
import { betterAuth } from 'better-auth'
import { createAuthEndpoint } from 'better-auth/api'
import { memoryAdapter } from 'better-auth/adapters/memory'
import { organization, magicLink } from 'better-auth/plugins'

vi.mock('nitropack/runtime', () => ({
  useNitroApp: () => ({ hooks: { callHook: vi.fn().mockResolvedValue(undefined) } })
}))

const { signupGate } = await import('../../../server/lib/auth')

const BASE = 'http://localhost:3000'

type Db = Record<string, any[]>

/**
 * Stand-in for an OAuth provider's callback: better-auth's social callback
 * creates the first-time user with `internalAdapter.createOAuthUser` inside an
 * HTTP endpoint. Driving a real provider needs network, so this endpoint makes
 * that exact call from the same kind of context.
 */
const oauthFirstSignIn = {
  id: 'oauth-first-sign-in',
  endpoints: {
    oauthFirstSignIn: createAuthEndpoint('/test/oauth-first-sign-in', { method: 'POST' }, async (ctx) => {
      const email = (ctx.body as { email: string }).email
      const created = await ctx.context.internalAdapter.createOAuthUser(
        { email, name: 'OAuth Person', emailVerified: true },
        { providerId: 'github', accountId: `gh-${email}` }
      )
      return ctx.json({ id: created?.user?.id ?? null })
    })
  }
}

function makeAuth(signup?: 'open' | 'invite') {
  const db: Db = { user: [], session: [], account: [], verification: [], organization: [], member: [], invitation: [] }
  const magicLinks: string[] = []
  const auth = betterAuth({
    baseURL: BASE,
    secret: 'test-secret-test-secret-test-secret-1234',
    database: memoryAdapter(db),
    emailAndPassword: { enabled: true },
    plugins: [
      organization({ sendInvitationEmail: async () => {} }),
      magicLink({ sendMagicLink: async ({ url }) => { magicLinks.push(url) } }),
      oauthFirstSignIn as any
    ],
    databaseHooks: { user: { create: { before: signupGate({ signup }) as any } } }
  })
  return { auth, db, magicLinks }
}

type Auth = ReturnType<typeof makeAuth>['auth']

/** A browser request through the HTTP handler (carries ctx.request). */
async function http(auth: Auth, path: string, body?: unknown, cookie?: string) {
  const res = await auth.handler(new Request(`${BASE}/api/auth${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      'content-type': 'application/json',
      origin: BASE,
      ...(cookie ? { cookie } : {})
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  }))
  let json: any = null
  try { json = await res.clone().json() } catch { /* not JSON */ }
  return { res, json }
}

const emails = (db: Db) => db.user.map(u => u.email)

/** Owner (made server-side) + an org + a pending invitation for `invitee`. */
async function ownerInvites(auth: Auth, invitee: string) {
  const owner = await auth.api.signUpEmail({ body: { email: 'owner@x.com', password: 'password123', name: 'Owner' }, returnHeaders: true })
  const cookie = owner.headers.getSetCookie().map(c => c.split(';')[0]).join('; ')
  const org = await auth.api.createOrganization({ body: { name: 'Team', slug: 'team' }, headers: new Headers({ cookie }) })
  const invitation = await auth.api.createInvitation({
    body: { email: invitee, role: 'member', organizationId: org!.id },
    headers: new Headers({ cookie })
  })
  return { orgId: org!.id, invitationId: invitation.id }
}

describe('signupGate on a real better-auth (#3340)', () => {
  it('invite-only: a stranger signing up with email + password gets 403 SIGNUP_INVITE_ONLY and no account', async () => {
    const { auth, db } = makeAuth('invite')
    const { res, json } = await http(auth, '/sign-up/email', { email: 'stranger@x.com', password: 'password123', name: 'S' })
    expect(res.status).toBe(403)
    expect(json.code).toBe('SIGNUP_INVITE_ONLY')
    expect(emails(db)).toEqual([])
  })

  it('invite-only: a stranger\'s magic link creates no account', async () => {
    const { auth, db, magicLinks } = makeAuth('invite')
    const sent = await http(auth, '/sign-in/magic-link', { email: 'ml@x.com', callbackURL: '/' })
    expect(sent.res.status).toBe(200)
    expect(magicLinks).toHaveLength(1)
    await auth.handler(new Request(magicLinks[0]!, { headers: { origin: BASE } }))
    expect(emails(db)).toEqual([])

    // Control: the same flow on an open app DOES create the account, so the
    // empty list above is the gate's doing, not a broken verify step.
    const open = makeAuth('open')
    await http(open.auth, '/sign-in/magic-link', { email: 'ml@x.com', callbackURL: '/' })
    await open.auth.handler(new Request(open.magicLinks[0]!, { headers: { origin: BASE } }))
    expect(emails(open.db)).toEqual(['ml@x.com'])
  })

  it('invite-only: an OAuth-style first sign-in (createOAuthUser inside an HTTP endpoint) is refused', async () => {
    const { auth, db } = makeAuth('invite')
    const { res, json } = await http(auth, '/test/oauth-first-sign-in', { email: 'oauth@x.com' })
    expect(res.status).toBe(403)
    expect(json.code).toBe('SIGNUP_INVITE_ONLY')
    expect(emails(db)).toEqual([])
  })

  it('invite-only: the invited email can sign up over HTTP, accept, and becomes a member', async () => {
    const { auth, db } = makeAuth('invite')
    const { orgId, invitationId } = await ownerInvites(auth, 'Invitee@X.com')
    expect(db.invitation[0]!.email).toBe('invitee@x.com')

    const signUp = await http(auth, '/sign-up/email', { email: 'invitee@x.com', password: 'password123', name: 'I' })
    expect(signUp.res.status).toBe(200)
    const cookie = signUp.res.headers.getSetCookie().map(c => c.split(';')[0]).join('; ')

    const accept = await http(auth, '/organization/accept-invitation', { invitationId }, cookie)
    expect(accept.res.status).toBe(200)

    const invitee = db.user.find(u => u.email === 'invitee@x.com')
    expect(db.member.some(m => m.userId === invitee!.id && m.organizationId === orgId)).toBe(true)
  })

  it('invite-only: someone else\'s email while an invitation is pending → 403', async () => {
    const { auth, db } = makeAuth('invite')
    await ownerInvites(auth, 'invitee@x.com')
    const { res } = await http(auth, '/sign-up/email', { email: 'other@x.com', password: 'password123', name: 'O' })
    expect(res.status).toBe(403)
    expect(emails(db)).not.toContain('other@x.com')
  })

  it('invite-only: an expired invitation does not let you in', async () => {
    const { auth, db } = makeAuth('invite')
    await ownerInvites(auth, 'late@x.com')
    db.invitation[0]!.expiresAt = new Date(Date.now() - 60_000)
    const { res } = await http(auth, '/sign-up/email', { email: 'late@x.com', password: 'password123', name: 'L' })
    expect(res.status).toBe(403)
    expect(emails(db)).not.toContain('late@x.com')
  })

  it('invite-only: an already-accepted invitation does not let you in', async () => {
    const { auth, db } = makeAuth('invite')
    await ownerInvites(auth, 'used@x.com')
    db.invitation[0]!.status = 'accepted'
    const { res } = await http(auth, '/sign-up/email', { email: 'used@x.com', password: 'password123', name: 'U' })
    expect(res.status).toBe(403)
    expect(emails(db)).not.toContain('used@x.com')
  })

  it('invite-only: a server-side auth.api.signUpEmail with no headers (admin create-user) still creates the user', async () => {
    const { auth, db } = makeAuth('invite')
    const created = await auth.api.signUpEmail({ body: { email: 'made-by-admin@x.com', password: 'password123', name: 'A' } })
    expect(created.user.email).toBe('made-by-admin@x.com')
    expect(emails(db)).toContain('made-by-admin@x.com')
  })

  it.each([['open' as const], [undefined]])('signup %s: a stranger signs up over HTTP as before', async (signup) => {
    const { auth, db } = makeAuth(signup)
    const { res } = await http(auth, '/sign-up/email', { email: 'stranger@x.com', password: 'password123', name: 'S' })
    expect(res.status).toBe(200)
    expect(emails(db)).toEqual(['stranger@x.com'])
  })
})
