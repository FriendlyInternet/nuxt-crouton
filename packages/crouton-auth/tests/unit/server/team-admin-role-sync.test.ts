// @vitest-environment node
/**
 * An action declared later reaches every team's admin row, except in a team
 * whose owner removed it (#4283)
 *
 * Real Better Auth on one SQLite built from the fixture migrations (incl.
 * `NNNN_admin_removed_actions`), the real buildAuthHooks() and the real can().
 * A "redeploy" rebuilds access + Better Auth on the same database with more
 * declared actions, as the next deploy of a package that declares one would.
 * Only `nitropack/runtime` is mocked (the invitation e-mail hook).
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { setAuthInstance, isAuthInitialized } from '../../../server/lib/auth'
import { setAccessControl, type CroutonActionRegistry } from '../../../server/lib/access'
import { ensureTeamAdminRole, syncTeamAdminRole, type RawDb } from '../../../server/lib/team-admin-role'
import { can } from '../../../server/utils/permissions'
import { adminActionsToRolePermission, rolePermissionToActions } from '../../../shared/utils/team-roles'
import { DECLARED } from './helpers/access-setup'
import { outcome, setupAdminRoleWorld, type User } from './helpers/admin-role-setup'

vi.mock('nitropack/runtime', () => ({
  useNitroApp: () => ({ hooks: { callHook: vi.fn().mockResolvedValue(undefined) } })
}))

const ALL = Object.keys(DECLARED)
const WITHOUT_DOMAINS = ALL.filter(a => a !== 'team:domains')
const WITH_REFUND: CroutonActionRegistry = { ...DECLARED, 'shop:refund': { label: 'shop.refund' } }
const WITH_VOID: CroutonActionRegistry = { ...WITH_REFUND, 'shop:void': { label: 'shop.void' } }

type World = ReturnType<typeof setupAdminRoleWorld>
let world: World

afterEach(() => {
  world?.sqlite.close()
  setAccessControl(null)
  setAuthInstance(null as never)
  vi.unstubAllGlobals()
})

/** Two teams, each with an owner and an admin; A's owner took team:domains from A's admins. */
async function twoTeams() {
  world = setupAdminRoleWorld()
  const ownerA = await world.signUp('owner-a@example.com')
  const adminA = await world.signUp('admin-a@example.com')
  const ownerB = await world.signUp('owner-b@example.com')
  const adminB = await world.signUp('admin-b@example.com')
  const A = (await world.auth.api.createOrganization({ body: { name: 'Team A', slug: 'team-a' }, headers: ownerA.headers }))!.id
  const B = (await world.auth.api.createOrganization({ body: { name: 'Team B', slug: 'team-b' }, headers: ownerB.headers }))!.id
  await world.auth.api.addMember({ body: { userId: adminA.userId, role: 'admin', organizationId: A } })
  await world.auth.api.addMember({ body: { userId: adminB.userId, role: 'admin', organizationId: B } })
  await world.auth.api.updateOrgRole({
    body: { roleName: 'admin', data: { permission: adminActionsToRolePermission(WITHOUT_DOMAINS) }, organizationId: A },
    headers: ownerA.headers
  })
  return { A, B, ownerA, adminA, ownerB, adminB }
}

/** The team's one admin row: its crouton actions and its recorded removals. */
function rowOf(orgId: string, registry: CroutonActionRegistry) {
  const rows = world.adminRows(orgId)
  expect(rows).toHaveLength(1)
  return {
    actions: rolePermissionToActions(rows[0]!.permission, Object.keys(registry)),
    removed: rows[0]!.removedActions === null ? null : JSON.parse(rows[0]!.removedActions)
  }
}

async function listRoles(orgId: string, user: User) {
  await world.auth.api.listOrgRoles({ query: { organizationId: orgId }, headers: user.headers })
}

describe('a later-declared action reaches every team\'s admin row (#4283)', () => {
  // covers: T1
  it('the first list-roles call after a redeploy syncs each team; A keeps team:domains removed', async () => {
    const { A, B, ownerA, ownerB } = await twoTeams()
    world.redeploy(WITH_REFUND)

    await listRoles(A, ownerA)
    await listRoles(B, ownerB)

    const a = rowOf(A, WITH_REFUND)
    expect(a.actions).toContain('shop:refund')
    expect(a.actions).not.toContain('team:domains')
    expect(a.removed).toEqual(['team:domains'])
    const b = rowOf(B, WITH_REFUND)
    expect(b.actions).toContain('shop:refund')
    expect(b.actions).toContain('team:domains')
    expect(b.removed).toEqual([])
  })

  // covers: T2
  it('can() sees the new action straight after the redeploy, with and without an auth instance', async () => {
    const { A, B, ownerA, adminA, adminB } = await twoTeams()
    world.redeploy(WITH_REFUND)

    const check = async () => {
      expect(await can(B, adminB.userId, 'shop:refund')).toBe(true)
      expect(await can(A, adminA.userId, 'shop:refund')).toBe(true)
      expect(await can(A, adminA.userId, 'team:domains')).toBe(false)
      expect(await can(A, ownerA.userId, 'team:domains')).toBe(true)
    }
    await check()
    setAuthInstance(null as never)
    expect(isAuthInitialized()).toBe(false)
    await check()
    // No /organization/* call yet: the row itself is untouched.
    expect(rowOf(B, WITH_REFUND).actions).not.toContain('shop:refund')
  })

  // covers: T3
  it('re-ticking an action clears it from removed; a refused admin update records nothing', async () => {
    const { A, ownerA, adminA } = await twoTeams()
    world.redeploy(WITH_REFUND)
    await world.auth.api.updateOrgRole({
      body: { roleName: 'admin', data: { permission: adminActionsToRolePermission(Object.keys(WITH_REFUND)) }, organizationId: A },
      headers: ownerA.headers
    })
    expect(rowOf(A, WITH_REFUND).removed).toEqual([])

    world.redeploy(WITH_VOID)
    await listRoles(A, ownerA)
    expect(rowOf(A, WITH_VOID).actions).toContain('shop:void')
    expect(rowOf(A, WITH_VOID).actions).toContain('team:domains')

    // A marker the after-hook would overwrite with [] if it ran on a refused call.
    world.sqlite.prepare('UPDATE organizationRole SET removedActions = ? WHERE organizationId = ? AND role = ?').run('["marker:kept"]', A, 'admin')
    expect(await outcome(world.auth.api.updateOrgRole({
      body: { roleName: 'admin', data: { permission: adminActionsToRolePermission(Object.keys(WITH_VOID)) }, organizationId: A },
      headers: adminA.headers
    }))).toBe('ADMIN_ROLE_OWNER_ONLY')
    expect(rowOf(A, WITH_VOID).removed).toEqual(['marker:kept'])
  })

  // covers: T4
  it('a row from before #4283 (removedActions NULL) backfills what it lacks; parallel and stale syncs are safe', async () => {
    world = setupAdminRoleWorld()
    const owner = await world.signUp('owner@example.com')
    const org = async (slug: string) => (await world.auth.api.createOrganization({ body: { name: slug, slug }, headers: owner.headers }))!.id
    const legacy = await org('legacy')
    const edge = await org('edge')
    const par = await org('par')
    const twin = await org('twin')
    const stale = await org('stale')
    const asLeftBy4130 = (id: string) => world.sqlite
      .prepare('UPDATE organizationRole SET permission = ?, removedActions = NULL WHERE organizationId = ? AND role = ?')
      .run(JSON.stringify(adminActionsToRolePermission(WITHOUT_DOMAINS)), id, 'admin')
    asLeftBy4130(legacy)
    asLeftBy4130(edge)

    // One call under the old template backfills what the row lacks.
    await listRoles(legacy, owner)
    expect(rowOf(legacy, DECLARED).removed).toEqual(['team:domains'])

    world.redeploy(WITH_REFUND)
    await listRoles(legacy, owner)
    expect(rowOf(legacy, WITH_REFUND).actions).toContain('shop:refund')
    expect(rowOf(legacy, WITH_REFUND).actions).not.toContain('team:domains')

    // The logged edge: a NULL row first synced under the new template counts the new action as removed.
    await syncTeamAdminRole(world.db as unknown as RawDb, edge, world.access)
    expect(rowOf(edge, WITH_REFUND).removed).toEqual(['team:domains', 'shop:refund'])
    expect(rowOf(edge, WITH_REFUND).actions).not.toContain('shop:refund')

    // Five parallel syncs = one sync.
    await Promise.all(Array.from({ length: 5 }, () => syncTeamAdminRole(world.db as unknown as RawDb, par, world.access)))
    await syncTeamAdminRole(world.db as unknown as RawDb, twin, world.access)
    expect(world.adminRows(par)).toHaveLength(1)
    expect(JSON.parse(world.adminRows(par)[0]!.permission)).toEqual(JSON.parse(world.adminRows(twin)[0]!.permission))
    expect(rowOf(par, WITH_REFUND).actions).toContain('shop:refund')

    // An owner save between the sync's read and its write wins.
    const newer = JSON.stringify(adminActionsToRolePermission(['pages:edit']))
    const racing: RawDb = {
      all: (async (q: never) => {
        const rows = await (world.db as unknown as RawDb).all(q)
        world.sqlite.prepare('UPDATE organizationRole SET permission = ? WHERE organizationId = ? AND role = ?').run(newer, stale, 'admin')
        return rows
      }) as RawDb['all'],
      run: ((q: never) => (world.db as unknown as RawDb).run(q)) as RawDb['run']
    }
    await syncTeamAdminRole(racing, stale, world.access)
    expect(world.adminRows(stale)[0]!.permission).toBe(newer)
  })

  // covers: T6
  it('a team seeded only by ensureTeamAdminRole records [] and gets the new action', async () => {
    world = setupAdminRoleWorld()
    const owner = await world.signUp('owner-s@example.com')
    const admin = await world.signUp('admin-s@example.com')
    const now = Math.floor(Date.now() / 1000)
    world.sqlite.prepare('INSERT INTO organization (id, name, slug, createdAt) VALUES (?, ?, ?, ?)').run('team-s', 'S', 'team-s', now)
    world.sqlite.prepare('INSERT INTO member (id, organizationId, userId, role, createdAt) VALUES (?, ?, ?, ?, ?)').run('m-owner', 'team-s', owner.userId, 'owner', now)
    world.sqlite.prepare('INSERT INTO member (id, organizationId, userId, role, createdAt) VALUES (?, ?, ?, ?, ?)').run('m-admin', 'team-s', admin.userId, 'admin', now)
    await ensureTeamAdminRole(world.db as unknown as RawDb, 'team-s', world.access)
    expect(world.adminRows('team-s')[0]!.removedActions).toBe('[]')

    world.redeploy(WITH_REFUND)
    expect(await can('team-s', admin.userId, 'shop:refund')).toBe(true)

    await listRoles('team-s', owner)
    const row = rowOf('team-s', WITH_REFUND)
    expect(row.actions).toContain('shop:refund')
    expect(row.removed).toEqual([])
  })
})
