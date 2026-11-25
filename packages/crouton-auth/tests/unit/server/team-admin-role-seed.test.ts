// @vitest-environment node
/**
 * Every way a team is made leaves it with exactly one admin row (#4130, T4)
 *
 * Teams are made by Better Auth (`afterCreateOrganization`) and by three raw-SQL
 * inserts that skip Better Auth's hooks: the default team (`ensureDefaultOrgExists`,
 * through createAuth's databaseHooks), the personal team (`createPersonalOrg`)
 * and `getOrCreateDefaultOrganization`. A team made outside all four (the
 * content seed) gets its row on its first `/organization/*` call. Real tables
 * from the fixture migrations on better-sqlite3; real better-auth.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import type { H3Event } from 'h3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import type Database from 'better-sqlite3'
import * as authSchema from '../../../server/database/schema/auth'
import { buildOrganizationConfig, createAuth, setAuthInstance } from '../../../server/lib/auth'
import { adminRolePermission, buildAccessControl, setAccessControl } from '../../../server/lib/access'
import { ensureTeamAdminRole } from '../../../server/lib/team-admin-role'
import { getOrCreateDefaultOrganization } from '../../../server/utils/team'
import { DECLARED } from './helpers/access-setup'
import { openMigratedDb, setupAdminRoleWorld } from './helpers/admin-role-setup'

vi.mock('nitropack/runtime', () => ({
  useNitroApp: () => ({ hooks: { callHook: vi.fn().mockResolvedValue(undefined) } })
}))

let sqlite: Database.Database | null = null

afterEach(() => {
  sqlite?.close()
  sqlite = null
  setAccessControl(null)
  setAuthInstance(null as never)
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function adminRows(orgId: string): Array<{ permission: string }> {
  return sqlite!.prepare('SELECT permission FROM organizationRole WHERE organizationId = ? AND role = ?').all(orgId, 'admin') as never
}

function orgIdBySlug(slug: string): string {
  return (sqlite!.prepare('SELECT id FROM organization WHERE slug = ?').get(slug) as { id: string }).id
}

function rawDb() {
  sqlite = openMigratedDb()
  return drizzle(sqlite, { schema: authSchema })
}

const access = () => buildAccessControl({ actions: DECLARED })

/** createAuth() for real; its databaseHooks run the raw-SQL team paths. */
function databaseHooks(config: Parameters<typeof createAuth>[0]['config'], db: unknown) {
  const auth = createAuth({ config, db: db as never, secret: 'test-secret-test-secret-test-secret-123', baseURL: 'https://velo.pmcp.dev', access: access() })
  return (auth as unknown as { options: { databaseHooks: any } }).options.databaseHooks
}

const newUser = { id: 'user-1', name: 'Ada', email: 'ada@example.com' }

/** The user row Better Auth would already have written before `user.create.after`. */
function insertNewUser() {
  sqlite!.prepare('INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 0, 0, 0)').run(newUser.id, newUser.name, newUser.email)
}

describe('every team-creation path seeds one admin row (#4130)', () => {
  // covers: T4
  it('afterCreateOrganization (Better Auth), twice → one row from the template', async () => {
    const db = rawDb()
    const acc = access()
    sqlite!.prepare('INSERT INTO organization (id, name, slug, createdAt) VALUES (?, ?, ?, ?)').run('org-1', 'One', 'one', 0)
    const hooks = buildOrganizationConfig({}, db as never, acc).organizationHooks
    const ctx = { organization: { id: 'org-1', name: 'One', slug: 'one' }, user: { id: 'u', name: 'U' } }
    await hooks.afterCreateOrganization(ctx)
    await hooks.afterCreateOrganization(ctx)

    expect(adminRows('org-1')).toHaveLength(1)
    expect(JSON.parse(adminRows('org-1')[0]!.permission)).toEqual(adminRolePermission(acc))
  })

  // covers: T4
  it('ensureDefaultOrgExists (defaultTeamSlug), on sign-up and sign-in → one row', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const db = rawDb()
    insertNewUser()
    const hooks = databaseHooks({ teams: { defaultTeamSlug: 'acme' } }, db)
    await hooks.user.create.after(newUser)
    await hooks.session.create.before({ userId: newUser.id })

    const org = orgIdBySlug('acme')
    expect(adminRows(org)).toHaveLength(1)
    expect(JSON.parse(adminRows(org)[0]!.permission)).toEqual(adminRolePermission(access()))
  })

  // covers: T4
  it('createPersonalOrg (autoCreateOnSignup) → one row', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const db = rawDb()
    insertNewUser()
    await databaseHooks({ teams: { autoCreateOnSignup: true } }, db).user.create.after(newUser)

    const org = orgIdBySlug(`personal-${newUser.id.substring(0, 8)}`)
    expect(adminRows(org)).toHaveLength(1)
    expect(JSON.parse(adminRows(org)[0]!.permission)).toEqual(adminRolePermission(access()))
  })

  // covers: T4
  it('getOrCreateDefaultOrganization, twice → one row', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const db = rawDb()
    vi.stubGlobal('useDB', () => db)
    setAccessControl(access())
    const event = { context: {} } as unknown as H3Event
    const team = await getOrCreateDefaultOrganization(event)
    await getOrCreateDefaultOrganization(event)

    expect(adminRows(team.id)).toHaveLength(1)
    expect(JSON.parse(adminRows(team.id)[0]!.permission)).toEqual(adminRolePermission(access()))
  })

  // covers: T4
  it('five parallel ensures on one team → one row', async () => {
    const db = rawDb()
    sqlite!.prepare('INSERT INTO organization (id, name, slug, createdAt) VALUES (?, ?, ?, ?)').run('org-p', 'P', 'p', 0)
    const acc = access()
    await Promise.all(Array.from({ length: 5 }, () => ensureTeamAdminRole(db as never, 'org-p', acc)))

    expect(adminRows('org-p')).toHaveLength(1)
  })

  // covers: T4
  it('a team made outside those paths (the content seed) gets its row on its first /organization call', async () => {
    const world = setupAdminRoleWorld()
    sqlite = world.sqlite
    const owner = await world.signUp('owner@example.com')
    sqlite.prepare('INSERT INTO organization (id, name, slug, createdAt) VALUES (?, ?, ?, ?)').run('test1', 'Test 1', 'test1', 0)
    sqlite.prepare('INSERT INTO member (id, organizationId, userId, role, createdAt) VALUES (?, ?, ?, ?, ?)').run('m-seed', 'test1', owner.userId, 'owner', 0)
    expect(adminRows('test1')).toHaveLength(0)

    const roles = await world.auth.api.listOrgRoles({ query: { organizationId: 'test1' }, headers: owner.headers })

    expect(roles.map(r => r.role)).toEqual(['admin'])
    expect(adminRows('test1')).toHaveLength(1)
  })
})
