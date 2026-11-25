// @vitest-environment node
/**
 * Built roles keep Better Auth's own rights (#4104, T5)
 *
 * Passing a custom `roles` map to the organization plugin REPLACES Better
 * Auth's defaults (has-permission.mjs:8). buildAccessControl() merges
 * ownerAc/adminAc/memberAc's statements into each role, so admins can still
 * invite and change roles, and members still can't.
 *
 * Real Better Auth endpoints (auth.api.*) over a memory adapter, organization
 * plugin configured by the real buildOrganizationConfig(). Only
 * `nitropack/runtime` is mocked (the invitation e-mail hook).
 */
import { describe, it, expect, vi, beforeAll } from 'vitest'
import { betterAuth } from 'better-auth'
import { memoryAdapter } from 'better-auth/adapters/memory'
import { organization } from 'better-auth/plugins'
import { buildOrganizationConfig } from '../../../server/lib/auth'
import { buildAccessControl } from '../../../server/lib/access'
import { buildAuthHooks } from '../../../server/lib/team-admin-role'
import { seedAdminRow } from './helpers/access-setup'

vi.mock('nitropack/runtime', () => ({
  useNitroApp: () => ({ hooks: { callHook: vi.fn().mockResolvedValue(undefined) } })
}))

const ORIGIN = 'https://velo.pmcp.dev'

const access = buildAccessControl({ actions: { 'pages:edit': { label: 'permissions.pagesEdit' } } })

function makeAuth() {
  return betterAuth({
    database: memoryAdapter({ user: [], session: [], account: [], verification: [], organization: [], member: [], invitation: [], organizationRole: [] }),
    secret: 'test-secret-test-secret-test-secret-123',
    baseURL: ORIGIN,
    emailAndPassword: { enabled: true },
    plugins: [organization(buildOrganizationConfig({}, undefined, access) as never)],
    // As createAuth() wires it: admin is each team's own row (#4130).
    hooks: buildAuthHooks(access)
  })
}

type Auth = ReturnType<typeof makeAuth>

async function signUp(auth: Auth, email: string) {
  const res = await auth.api.signUpEmail({
    body: { email, password: 'correct-horse-battery-staple', name: email.split('@')[0]! },
    returnHeaders: true
  })
  const cookie = res.headers.get('set-cookie')!.split(';')[0]!
  return { userId: res.response.user.id, headers: new Headers({ cookie, origin: ORIGIN }) }
}

async function status(p: Promise<unknown>): Promise<string> {
  try {
    await p
    return 'ok'
  }
  catch (e) {
    return (e as { status?: string }).status ?? String(e)
  }
}

describe('built roles keep Better Auth\'s own rights (T5)', () => {
  let auth: Auth
  let owner: Awaited<ReturnType<typeof signUp>>
  let admin: Awaited<ReturnType<typeof signUp>>
  let member: Awaited<ReturnType<typeof signUp>>
  let other: Awaited<ReturnType<typeof signUp>>
  let orgId: string
  let otherMemberId: string

  beforeAll(async () => {
    auth = makeAuth()
    owner = await signUp(auth, 'owner@example.com')
    admin = await signUp(auth, 'admin@example.com')
    member = await signUp(auth, 'member@example.com')
    other = await signUp(auth, 'other@example.com')
    const org = await auth.api.createOrganization({ body: { name: 'Acme', slug: 'acme' }, headers: owner.headers })
    orgId = org!.id
    // What createAuth's team-creation hooks do in production (#4130): the team gets its admin row.
    await seedAdminRow(auth, orgId, access)
    await auth.api.addMember({ body: { userId: admin.userId, role: 'admin', organizationId: orgId } })
    await auth.api.addMember({ body: { userId: member.userId, role: 'member', organizationId: orgId } })
    const added = await auth.api.addMember({ body: { userId: other.userId, role: 'member', organizationId: orgId } })
    otherMemberId = added!.id
  })

  it('an admin can still invite', async () => {
    const invite = await auth.api.createInvitation({
      body: { email: 'new@example.com', role: 'member', organizationId: orgId },
      headers: admin.headers
    })
    expect(invite.email).toBe('new@example.com')
  })

  it('a member cannot invite', async () => {
    expect(await status(auth.api.createInvitation({
      body: { email: 'new2@example.com', role: 'member', organizationId: orgId },
      headers: member.headers
    }))).toBe('FORBIDDEN')
  })

  it('a member cannot change a role', async () => {
    expect(await status(auth.api.updateMemberRole({
      body: { memberId: otherMemberId, role: 'admin', organizationId: orgId },
      headers: member.headers
    }))).toBe('FORBIDDEN')
  })

  it('an admin can still change a member\'s role', async () => {
    const updated = await auth.api.updateMemberRole({
      body: { memberId: otherMemberId, role: 'admin', organizationId: orgId },
      headers: admin.headers
    })
    expect(updated.role).toBe('admin')
  })
})
