// @vitest-environment node
/**
 * Team roles (#4106, T1–T5) — a team creates its own role with chosen actions,
 * gives it to a member, and that member gets exactly those actions.
 *
 * Real Better Auth endpoints (auth.api.*) over a memory adapter that has the
 * `organizationRole` table, organization plugin configured by the real
 * buildOrganizationConfig() (dynamic access control on). can() is the real one:
 * it reads the member's role from a real SQLite `member` table (the way
 * team.ts does in production) and asks Better Auth's hasPermission with the
 * auth context, so the team's stored role is loaded. Only `nitropack/runtime`
 * is mocked (the invitation e-mail hook).
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { betterAuth } from 'better-auth'
import { memoryAdapter } from 'better-auth/adapters/memory'
import { organization } from 'better-auth/plugins'
import * as authSchema from '../../../server/database/schema/auth'
import { buildOrganizationConfig, setAuthInstance } from '../../../server/lib/auth'
import { buildAccessControl, setAccessControl } from '../../../server/lib/access'
import { buildAuthHooks } from '../../../server/lib/team-admin-role'
import { can } from '../../../server/utils/permissions'
import { actionsToRolePermission } from '../../../shared/utils/team-roles'
import { DECLARED, seedAdminRow } from './helpers/access-setup'

vi.mock('nitropack/runtime', () => ({
  useNitroApp: () => ({ hooks: { callHook: vi.fn().mockResolvedValue(undefined) } })
}))

const ORIGIN = 'https://velo.pmcp.dev'

const access = buildAccessControl({ actions: DECLARED })

function makeAuth() {
  setAccessControl(access)
  const auth = betterAuth({
    database: memoryAdapter({ user: [], session: [], account: [], verification: [], organization: [], member: [], invitation: [], organizationRole: [] }),
    secret: 'test-secret-test-secret-test-secret-123',
    baseURL: ORIGIN,
    emailAndPassword: { enabled: true },
    plugins: [organization(buildOrganizationConfig({}, undefined, access) as never)],
    // As createAuth() wires it: each team's admin row + its guard (#4130).
    hooks: buildAuthHooks(access)
  })
  setAuthInstance(auth as never)
  return auth
}

type Auth = ReturnType<typeof makeAuth>
type User = { userId: string, headers: Headers }

async function signUp(auth: Auth, email: string): Promise<User> {
  const res = await auth.api.signUpEmail({
    body: { email, password: 'correct-horse-battery-staple', name: email.split('@')[0]! },
    returnHeaders: true
  })
  const cookie = res.headers.get('set-cookie')!.split(';')[0]!
  return { userId: res.response.user.id, headers: new Headers({ cookie, origin: ORIGIN }) }
}

/** 'ok', or Better Auth's error code (falls back to the HTTP status name). */
async function outcome(p: Promise<unknown>): Promise<string> {
  try {
    await p
    return 'ok'
  }
  catch (e) {
    const err = e as { status?: string, body?: { code?: string } }
    return err.body?.code ?? err.status ?? String(e)
  }
}

async function statusOf(p: Promise<unknown>): Promise<string> {
  try {
    await p
    return 'ok'
  }
  catch (e) {
    return (e as { status?: string }).status ?? String(e)
  }
}

describe('team roles (#4106)', () => {
  let auth: Auth
  let sqlite: Database.Database
  let owner: User, admin: User, editor: User, manager: User, pagesOnly: User, target: User
  let orgX: string, orgY: string
  const memberIds: Record<string, string> = {}

  /** Mirror a member row into the SQLite table can() reads (team.ts). */
  function mirror(orgId: string, user: User, role: string) {
    sqlite.prepare('INSERT OR REPLACE INTO member (id, userId, organizationId, role, createdAt) VALUES (?, ?, ?, ?, ?)')
      .run(`${orgId}:${user.userId}`, user.userId, orgId, role, Date.now())
  }

  async function addMember(orgId: string, user: User, role: string, key: string) {
    const added = await auth.api.addMember({ body: { userId: user.userId, role: role as never, organizationId: orgId } })
    memberIds[key] = added!.id
    mirror(orgId, user, role)
  }

  async function setRole(orgId: string, as: User, key: string, user: User, role: string) {
    await auth.api.updateMemberRole({ body: { memberId: memberIds[key]!, role, organizationId: orgId }, headers: as.headers })
    mirror(orgId, user, role)
  }

  beforeAll(async () => {
    sqlite = new Database(':memory:')
    sqlite.exec('CREATE TABLE `member` (`id` text PRIMARY KEY NOT NULL, `userId` text NOT NULL, `organizationId` text NOT NULL, `role` text DEFAULT \'member\' NOT NULL, `createdAt` integer NOT NULL)')
    const db = drizzle(sqlite, { schema: authSchema })
    vi.stubGlobal('useDB', () => db)

    auth = makeAuth()
    owner = await signUp(auth, 'owner@example.com')
    admin = await signUp(auth, 'admin@example.com')
    editor = await signUp(auth, 'editor@example.com')
    manager = await signUp(auth, 'manager@example.com')
    pagesOnly = await signUp(auth, 'pages@example.com')
    target = await signUp(auth, 'target@example.com')

    const x = await auth.api.createOrganization({ body: { name: 'Team X', slug: 'team-x' }, headers: owner.headers })
    orgX = x!.id
    mirror(orgX, owner, 'owner')
    const y = await auth.api.createOrganization({ body: { name: 'Team Y', slug: 'team-y' }, headers: owner.headers })
    orgY = y!.id
    mirror(orgY, owner, 'owner')
    // What createAuth's team-creation hooks do in production (#4130): each team gets its admin row.
    await seedAdminRow(auth, orgX, access)
    await seedAdminRow(auth, orgY, access)

    const owners = await auth.api.listMembers({ query: { organizationId: orgX }, headers: owner.headers })
    memberIds.owner = owners.members.find(m => m.userId === owner.userId)!.id

    await addMember(orgX, admin, 'admin', 'admin')
    await addMember(orgX, editor, 'member', 'editor')
    await addMember(orgX, manager, 'member', 'manager')
    await addMember(orgX, pagesOnly, 'member', 'pagesOnly')
    await addMember(orgX, target, 'member', 'target')
    await addMember(orgY, editor, 'member', 'editorY')

    await auth.api.createOrgRole({
      body: { role: 'éditeur', permission: actionsToRolePermission(['pages:edit']), organizationId: orgX },
      headers: owner.headers
    })
    await auth.api.createOrgRole({
      body: { role: 'gestionnaire', permission: actionsToRolePermission(['team:manage']), organizationId: orgX },
      headers: owner.headers
    })
    await setRole(orgX, owner, 'editor', editor, 'éditeur')
    await setRole(orgX, owner, 'manager', manager, 'gestionnaire')
    await setRole(orgX, owner, 'pagesOnly', pagesOnly, 'éditeur')
  })

  afterAll(() => {
    sqlite.close()
    setAccessControl(null)
    setAuthInstance(null as never)
    vi.unstubAllGlobals()
  })

  // covers: T1
  it('a member with a team role "éditeur" (pages:edit) can pages:edit, not collections:manage, and reaches admin:access', async () => {
    expect(await can(orgX, editor.userId, 'pages:edit')).toBe(true)
    expect(await can(orgX, editor.userId, 'collections:manage')).toBe(false)
    expect(await can(orgX, editor.userId, 'admin:access')).toBe(true)
    expect(await can(orgX, editor.userId, 'team:manage')).toBe(false)
  })

  // covers: T2 (rule)
  it('base roles can\'t be created, edited or deleted', async () => {
    expect(await outcome(auth.api.createOrgRole({
      body: { role: 'admin', permission: { pages: ['edit'] }, organizationId: orgX }, headers: owner.headers
    }))).toBe('ROLE_NAME_IS_ALREADY_TAKEN')
    expect(await outcome(auth.api.deleteOrgRole({
      body: { roleName: 'owner', organizationId: orgX }, headers: owner.headers
    }))).toBe('CANNOT_DELETE_A_PRE_DEFINED_ROLE')
    expect(await outcome(auth.api.updateOrgRole({
      body: { roleName: 'member', data: { permission: { pages: ['edit'] } }, organizationId: orgX }, headers: owner.headers
    }))).toBe('ROLE_NOT_FOUND')
    // admin is the team's own row (#4130): never deleted; only the owner edits it (team-admin-role.test.ts).
    expect(await outcome(auth.api.deleteOrgRole({
      body: { roleName: 'admin', organizationId: orgX }, headers: owner.headers
    }))).toBe('ADMIN_ROLE_CANNOT_BE_DELETED')
  })

  it('the last owner can\'t be demoted, and an admin can\'t change the owner', async () => {
    expect(await statusOf(auth.api.updateMemberRole({
      body: { memberId: memberIds.owner!, role: 'éditeur', organizationId: orgX }, headers: owner.headers
    }))).toBe('BAD_REQUEST')
    expect(await statusOf(auth.api.updateMemberRole({
      body: { memberId: memberIds.owner!, role: 'member', organizationId: orgX }, headers: admin.headers
    }))).toBe('FORBIDDEN')
  })

  // covers: T3
  it('deleting a role a member still has is refused; once nobody has it, delete works', async () => {
    await auth.api.createOrgRole({
      body: { role: 'temp', permission: actionsToRolePermission(['site:manage']), organizationId: orgX }, headers: owner.headers
    })
    await setRole(orgX, owner, 'target', target, 'temp')
    expect(await outcome(auth.api.deleteOrgRole({
      body: { roleName: 'temp', organizationId: orgX }, headers: owner.headers
    }))).toBe('ROLE_IS_ASSIGNED_TO_MEMBERS')

    await setRole(orgX, owner, 'target', target, 'member')
    expect(await outcome(auth.api.deleteOrgRole({
      body: { roleName: 'temp', organizationId: orgX }, headers: owner.headers
    }))).toBe('ok')
  })

  // covers: T4 (rule)
  it('a role created in team X doesn\'t exist in team Y', async () => {
    const inY = await auth.api.listOrgRoles({ query: { organizationId: orgY }, headers: owner.headers })
    // Only Y's own admin row (#4130) — none of X's roles.
    expect(inY.map(r => r.role)).toEqual(['admin'])
    expect(await outcome(auth.api.updateMemberRole({
      body: { memberId: memberIds.editorY!, role: 'éditeur', organizationId: orgY }, headers: owner.headers
    }))).toBe('ROLE_NOT_FOUND')
    expect(await can(orgY, editor.userId, 'pages:edit')).toBe(false)
  })

  // covers: T5 (rule)
  it('a team role with team:manage can invite, change a role and create a role, and opens the Rôles tab', async () => {
    expect(await can(orgX, manager.userId, 'team:manage')).toBe(true)
    expect(await outcome(auth.api.createInvitation({
      body: { email: 'new@example.com', role: 'member', organizationId: orgX }, headers: manager.headers
    }))).toBe('ok')
    expect(await outcome(auth.api.updateMemberRole({
      body: { memberId: memberIds.target!, role: 'admin', organizationId: orgX }, headers: manager.headers
    }))).toBe('ok')
    expect(await outcome(auth.api.createOrgRole({
      body: { role: 'helper', permission: actionsToRolePermission(['team:manage']), organizationId: orgX }, headers: manager.headers
    }))).toBe('ok')
    // only actions they hold themselves
    expect(await outcome(auth.api.createOrgRole({
      body: { role: 'redacteur', permission: actionsToRolePermission(['pages:edit']), organizationId: orgX }, headers: manager.headers
    }))).toBe('YOU_ARE_NOT_ALLOWED_TO_CREATE_A_ROLE')
    // …and can't edit a role that carries an action they don't hold (why the screen opens it read-only)
    expect(await outcome(auth.api.updateOrgRole({
      body: { roleName: 'éditeur', data: { permission: actionsToRolePermission(['pages:edit', 'team:manage']) }, organizationId: orgX }, headers: manager.headers
    }))).toBe('YOU_ARE_NOT_ALLOWED_TO_UPDATE_A_ROLE')
  })

  it('without team:manage, none of that', async () => {
    expect(await can(orgX, pagesOnly.userId, 'team:manage')).toBe(false)
    expect(await statusOf(auth.api.createInvitation({
      body: { email: 'other@example.com', role: 'member', organizationId: orgX }, headers: pagesOnly.headers
    }))).toBe('FORBIDDEN')
    expect(await statusOf(auth.api.updateMemberRole({
      body: { memberId: memberIds.target!, role: 'member', organizationId: orgX }, headers: pagesOnly.headers
    }))).toBe('FORBIDDEN')
    expect(await statusOf(auth.api.createOrgRole({
      body: { role: 'nope', permission: actionsToRolePermission(['pages:edit']), organizationId: orgX }, headers: pagesOnly.headers
    }))).toBe('FORBIDDEN')
  })
})
