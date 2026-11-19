// @vitest-environment node
/**
 * The team's admin role is a row per team that only the owner edits (#4130)
 *
 * Ports the research check (writeups/architecture/team-admin-role-override.check.mjs,
 * C2–C15) onto crouton's real wiring: Better Auth endpoints (auth.api.*) on
 * drizzleAdapter over one SQLite built from the fixture migrations, the
 * organization plugin from the real buildOrganizationConfig(), the guard from
 * the real buildAuthHooks(), and the real can() reading the same database.
 * Only `nitropack/runtime` is mocked (the invitation e-mail hook).
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import type Database from 'better-sqlite3'
import { setAuthInstance, isAuthInitialized } from '../../../server/lib/auth'
import { adminRolePermission, setAccessControl } from '../../../server/lib/access'
import { can } from '../../../server/utils/permissions'
import { actionsToRolePermission, adminActionsToRolePermission } from '../../../shared/utils/team-roles'
import { DECLARED } from './helpers/access-setup'
import { outcome, setupAdminRoleWorld, type User } from './helpers/admin-role-setup'

vi.mock('nitropack/runtime', () => ({
  useNitroApp: () => ({ hooks: { callHook: vi.fn().mockResolvedValue(undefined) } })
}))

const ALL = Object.keys(DECLARED)
const WITHOUT_DOMAINS = ALL.filter(a => a !== 'team:domains')

describe('the team\'s admin role (#4130)', () => {
  let world: ReturnType<typeof setupAdminRoleWorld>
  let ownerA: User, adminA: User, ownerB: User, adminB: User, memberA: User
  let A: string, B: string
  let memberAId: string

  /** The owner of A sets what A's admins may do. */
  async function ownerSetsAdmin(actions: string[]) {
    await world.auth.api.updateOrgRole({
      body: { roleName: 'admin', data: { permission: adminActionsToRolePermission(actions) }, organizationId: A },
      headers: ownerA.headers
    })
  }

  /** Exactly one admin row in A, holding `permission`. */
  function expectAdminRowOf(permission: Record<string, string[]>) {
    const rows = world.adminRows(A)
    expect(rows).toHaveLength(1)
    expect(JSON.parse(rows[0]!.permission)).toEqual(permission)
  }

  beforeAll(async () => {
    world = setupAdminRoleWorld()
    ownerA = await world.signUp('owner-a@example.com')
    adminA = await world.signUp('admin-a@example.com')
    ownerB = await world.signUp('owner-b@example.com')
    adminB = await world.signUp('admin-b@example.com')
    memberA = await world.signUp('member-a@example.com')
    A = (await world.auth.api.createOrganization({ body: { name: 'Team A', slug: 'team-a' }, headers: ownerA.headers }))!.id
    B = (await world.auth.api.createOrganization({ body: { name: 'Team B', slug: 'team-b' }, headers: ownerB.headers }))!.id
    await world.auth.api.addMember({ body: { userId: adminA.userId, role: 'admin', organizationId: A } })
    await world.auth.api.addMember({ body: { userId: adminB.userId, role: 'admin', organizationId: B } })
    memberAId = (await world.auth.api.addMember({ body: { userId: memberA.userId, role: 'member', organizationId: A } }))!.id
  })

  afterAll(() => {
    world.sqlite.close()
    setAccessControl(null)
    setAuthInstance(null as never)
    vi.unstubAllGlobals()
  })

  it('every new team starts with one admin row, from the template', () => {
    expect(world.adminRows(A)).toHaveLength(1)
    expect(world.adminRows(B)).toHaveLength(1)
    expect(JSON.parse(world.adminRows(A)[0]!.permission)).toEqual(adminRolePermission(world.access))
  })

  // covers: T1
  it('the owner of A takes team:domains from A\'s admins; B\'s admins and A\'s owner keep it', async () => {
    expect(await can(A, adminA.userId, 'team:domains')).toBe(true)
    await ownerSetsAdmin(WITHOUT_DOMAINS)

    expect(await can(A, adminA.userId, 'team:domains')).toBe(false)
    expect(await can(A, adminA.userId, 'pages:edit')).toBe(true)
    expect(await can(B, adminB.userId, 'team:domains')).toBe(true)
    expect(await can(A, ownerA.userId, 'team:domains')).toBe(true)
  })

  // covers: T2
  it('only the owner edits the admin row; nobody renames or deletes it; nothing else is named admin', async () => {
    await ownerSetsAdmin(WITHOUT_DOMAINS)
    const before = adminActionsToRolePermission(WITHOUT_DOMAINS)
    const rowId = world.adminRows(A)[0]!.id
    const api = world.auth.api

    // An admin can neither add an action back nor shrink the row — by name or by id.
    expect(await outcome(api.updateOrgRole({ body: { roleName: 'admin', data: { permission: adminActionsToRolePermission(ALL) }, organizationId: A }, headers: adminA.headers }))).toBe('ADMIN_ROLE_OWNER_ONLY')
    expectAdminRowOf(before)
    expect(await outcome(api.updateOrgRole({ body: { roleName: 'admin', data: { permission: adminActionsToRolePermission(['team:manage']) }, organizationId: A }, headers: adminA.headers }))).toBe('ADMIN_ROLE_OWNER_ONLY')
    expectAdminRowOf(before)
    expect(await outcome(api.updateOrgRole({ body: { roleId: rowId, data: { permission: adminActionsToRolePermission(['team:manage']) }, organizationId: A }, headers: adminA.headers }))).toBe('ADMIN_ROLE_OWNER_ONLY')
    expectAdminRowOf(before)

    // Nobody renames it, the owner included — by name or by id.
    expect(await outcome(api.updateOrgRole({ body: { roleName: 'admin', data: { roleName: 'chef' }, organizationId: A }, headers: ownerA.headers }))).toBe('ADMIN_ROLE_CANNOT_BE_RENAMED')
    expectAdminRowOf(before)
    expect(await outcome(api.updateOrgRole({ body: { roleId: rowId, data: { roleName: 'chef' }, organizationId: A }, headers: ownerA.headers }))).toBe('ADMIN_ROLE_CANNOT_BE_RENAMED')
    expectAdminRowOf(before)

    // Nobody deletes it — by name or by id.
    expect(await outcome(api.deleteOrgRole({ body: { roleName: 'admin', organizationId: A }, headers: ownerA.headers }))).toBe('ADMIN_ROLE_CANNOT_BE_DELETED')
    expectAdminRowOf(before)
    expect(await outcome(api.deleteOrgRole({ body: { roleId: rowId, organizationId: A }, headers: ownerA.headers }))).toBe('ADMIN_ROLE_CANNOT_BE_DELETED')
    expectAdminRowOf(before)
    expect(await outcome(api.deleteOrgRole({ body: { roleId: rowId, organizationId: A }, headers: adminA.headers }))).toBe('ADMIN_ROLE_CANNOT_BE_DELETED')
    expectAdminRowOf(before)

    // No second "admin": not created, and no other role renamed to it.
    expect(await outcome(api.createOrgRole({ body: { role: 'Admin', permission: actionsToRolePermission(['pages:edit']), organizationId: A }, headers: ownerA.headers }))).toBe('ROLE_NAME_IS_ALREADY_TAKEN')
    expect(await outcome(api.createOrgRole({ body: { role: 'helper', permission: actionsToRolePermission(['pages:edit']), organizationId: A }, headers: ownerA.headers }))).toBe('ok')
    expect(await outcome(api.updateOrgRole({ body: { roleName: 'helper', data: { roleName: ' admin ' }, organizationId: A }, headers: ownerA.headers }))).toBe('ROLE_NAME_IS_ALREADY_TAKEN')
    expectAdminRowOf(before)

    // The owner's own edit still goes through.
    expect(await outcome(api.updateOrgRole({ body: { roleId: rowId, data: { permission: adminActionsToRolePermission(ALL) }, organizationId: A }, headers: ownerA.headers }))).toBe('ok')
    expectAdminRowOf(adminActionsToRolePermission(ALL))
  })

  // covers: T3
  it('the owner takes team:manage from A\'s admins: they can\'t invite or change roles; B\'s still can', async () => {
    await ownerSetsAdmin(['pages:edit'])

    expect(await outcome(world.auth.api.createInvitation({
      body: { email: 'new-a@example.com', role: 'member', organizationId: A }, headers: adminA.headers
    }))).toBe('YOU_ARE_NOT_ALLOWED_TO_INVITE_USERS_TO_THIS_ORGANIZATION')
    expect(await outcome(world.auth.api.updateMemberRole({
      body: { memberId: memberAId, role: 'member', organizationId: A }, headers: adminA.headers
    }))).toBe('YOU_ARE_NOT_ALLOWED_TO_UPDATE_THIS_MEMBER')
    expect(await can(A, adminA.userId, 'team:manage')).toBe(false)

    expect(await outcome(world.auth.api.createInvitation({
      body: { email: 'new-b@example.com', role: 'member', organizationId: B }, headers: adminB.headers
    }))).toBe('ok')
  })

  // covers: T6
  it('the owner keeps team:manage and member:update whatever the admin row says', async () => {
    await ownerSetsAdmin([])

    expect(await can(A, ownerA.userId, 'team:manage')).toBe(true)
    const native = await world.auth.api.hasPermission({
      body: { organizationId: A, permissions: { member: ['update'] } }, headers: ownerA.headers
    })
    expect(native.success).toBe(true)
    expect(await can(A, adminA.userId, 'team:manage')).toBe(false)
  })
})

// covers: T9
describe('can() answers admin from the team\'s row with no auth instance (#4130)', () => {
  let sqlite: Database.Database

  afterAll(() => {
    sqlite?.close()
    setAccessControl(null)
    vi.unstubAllGlobals()
  })

  it('the stored row wins; a team with no row yet gets the template', async () => {
    const world = setupAdminRoleWorld()
    sqlite = world.sqlite
    setAuthInstance(null as never)
    expect(isAuthInitialized()).toBe(false)

    const now = Math.floor(Date.now() / 1000)
    for (const [org, member] of [['team-c', 'm-c'], ['team-d', 'm-d']]) {
      sqlite.prepare('INSERT INTO organization (id, name, slug, createdAt) VALUES (?, ?, ?, ?)').run(org, org, org, now)
      sqlite.prepare('INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 0, ?, ?)').run(`u-${org}`, org, `${org}@example.com`, now, now)
      sqlite.prepare('INSERT INTO member (id, organizationId, userId, role, createdAt) VALUES (?, ?, ?, ?, ?)').run(member, org, `u-${org}`, 'admin', now)
    }
    sqlite.prepare('INSERT INTO organizationRole (id, organizationId, role, permission, createdAt) VALUES (?, ?, ?, ?, ?)')
      .run('r-c', 'team-c', 'admin', JSON.stringify(adminActionsToRolePermission(WITHOUT_DOMAINS)), now)

    expect(await can('team-c', 'u-team-c', 'team:domains')).toBe(false)
    expect(await can('team-c', 'u-team-c', 'pages:edit')).toBe(true)
    expect(await can('team-d', 'u-team-d', 'team:domains')).toBe(true)
    expect(isAuthInitialized()).toBe(false)
  })
})
