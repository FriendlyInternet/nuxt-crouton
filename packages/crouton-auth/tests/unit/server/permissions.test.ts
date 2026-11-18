// @vitest-environment node
/**
 * can(teamId, userId, action) — crouton actions on Better Auth roles (#4104)
 *
 * The rule: with no site config, owner and admin can every action in the
 * #4104 table and member none; packages only declare actions; the owner
 * always keeps `team:manage`.
 *
 * No better-auth mock: can() runs against a real Better Auth instance
 * (memory adapter) whose organization plugin got the built `ac`/`roles`
 * through the real buildOrganizationConfig(). The member's role is read by the
 * real getOrganizationMembershipDirect() from a real SQLite `member` table.
 * Only `nitropack/runtime` is mocked (the e-mail hook), as in rate-limit.test.ts.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { betterAuth } from 'better-auth'
import { memoryAdapter } from 'better-auth/adapters/memory'
import { organization } from 'better-auth/plugins'
import * as authSchema from '../../../server/database/schema/auth'
import { buildOrganizationConfig, isAuthInitialized, setAuthInstance } from '../../../server/lib/auth'
import {
  buildAccessControl,
  setAccessControl,
  validateActions,
  validateBaseRoles,
  CROUTON_DEFAULT_ACTIONS,
  type BaseRolesConfig,
  type CroutonActionRegistry
} from '../../../server/lib/access'
import { can, canMany } from '../../../server/utils/permissions'

vi.mock('nitropack/runtime', () => ({
  useNitroApp: () => ({ hooks: { callHook: vi.fn().mockResolvedValue(undefined) } })
}))

const TEAM = 'team-1'
const OTHER_TEAM = 'team-2'

let sqlite: Database.Database

/** What the packages declare in their app.config (#4104 table) — declared-actions.test.ts checks the real files. */
const DECLARED: CroutonActionRegistry = {
  'admin:access': { label: 'permissions.adminAccess' },
  'team:manage': { label: 'permissions.teamManage' },
  'team:domains': { label: 'permissions.teamDomains' },
  'site:manage': { label: 'permissions.siteManage' },
  'collections:manage': { label: 'permissions.collectionsManage' },
  'translations:manage': { label: 'permissions.translationsManage' },
  'pages:edit': { label: 'permissions.pagesEdit' },
  'media:manage': { label: 'permissions.mediaManage' },
  'activity:view': { label: 'permissions.activityView' },
  'bookings:create': { label: 'permissions.bookingsCreate' },
  'bookings:manage': { label: 'permissions.bookingsManage' },
  'sales:manage': { label: 'permissions.salesManage' }
}

/** Wire a real Better Auth + access control the way createAuth() does. */
function setup(roles?: BaseRolesConfig, actions: CroutonActionRegistry = DECLARED) {
  const access = buildAccessControl({ actions, roles })
  setAccessControl(access)
  const auth = betterAuth({
    database: memoryAdapter({ user: [], session: [], account: [], verification: [], organization: [], member: [], invitation: [] }),
    secret: 'test-secret-test-secret-test-secret-123',
    baseURL: 'https://velo.pmcp.dev',
    plugins: [organization(buildOrganizationConfig({ teams: { roles } }, undefined, access) as never)]
  })
  setAuthInstance(auth as never)
  return access
}

beforeEach(() => {
  sqlite = new Database(':memory:')
  sqlite.exec('CREATE TABLE `member` (`id` text PRIMARY KEY NOT NULL, `userId` text NOT NULL, `organizationId` text NOT NULL, `role` text DEFAULT \'member\' NOT NULL, `createdAt` integer NOT NULL)')
  const insert = sqlite.prepare('INSERT INTO member (id, userId, organizationId, role, createdAt) VALUES (?, ?, ?, ?, ?)')
  insert.run('m1', 'u-owner', TEAM, 'owner', Date.now())
  insert.run('m2', 'u-admin', TEAM, 'admin', Date.now())
  insert.run('m3', 'u-member', TEAM, 'member', Date.now())
  const db = drizzle(sqlite, { schema: authSchema })
  vi.stubGlobal('useDB', () => db)
})

afterEach(() => {
  sqlite.close()
  setAccessControl(null)
  vi.unstubAllGlobals()
})

describe('can() — defaults with no site config (T1, the rule)', () => {
  it('owner and admin can every action in the table; member none', async () => {
    setup()
    expect(Object.keys(DECLARED)).toHaveLength(12)
    for (const action of Object.keys(DECLARED)) {
      expect(await can(TEAM, 'u-owner', action), `owner ${action}`).toBe(true)
      expect(await can(TEAM, 'u-admin', action), `admin ${action}`).toBe(true)
      expect(await can(TEAM, 'u-member', action), `member ${action}`).toBe(false)
    }
  })

  it('a newly declared action outside the fallback goes to owner and admin with no config', async () => {
    setup(undefined, { ...DECLARED, 'reports:export': { label: 'permissions.reportsExport' } })
    expect(CROUTON_DEFAULT_ACTIONS).not.toContain('reports:export')
    expect(await can(TEAM, 'u-owner', 'reports:export')).toBe(true)
    expect(await can(TEAM, 'u-admin', 'reports:export')).toBe(true)
    expect(await can(TEAM, 'u-member', 'reports:export')).toBe(false)
  })

  it('a config role still replaces the defaults for a newly declared action', async () => {
    setup({ admin: ['team:manage'] }, { ...DECLARED, 'reports:export': {} })
    expect(await can(TEAM, 'u-admin', 'reports:export')).toBe(false)
    expect(await can(TEAM, 'u-owner', 'reports:export')).toBe(true)
  })

  it('an action no package declares is unknown (only the fallback is built in)', async () => {
    setup(undefined, {})
    expect(await can(TEAM, 'u-owner', 'bookings:manage')).toBe(false)
    expect(await can(TEAM, 'u-owner', 'team:manage')).toBe(true)
  })
})

describe('a package action may not reuse a Better Auth permission name', () => {
  it('declaring member:create is refused with a clear message', () => {
    const message = /'member:create' is a Better Auth organization permission/
    expect(() => validateActions({ 'member:create': {} })).toThrow(message)
    expect(() => buildAccessControl({ actions: { 'member:create': {} } })).toThrow(message)
  })

  it('crouton-auth\'s own team:* actions do not collide (Better Auth only uses team:create/update/delete)', () => {
    expect(() => validateActions(DECLARED)).not.toThrow()
  })

  it('the startup plugin refuses that declaration at boot', async () => {
    vi.stubGlobal('defineNitroPlugin', (fn: () => void) => fn)
    vi.stubGlobal('useRuntimeConfig', () => ({ public: { crouton: { auth: {} } } }))
    vi.stubGlobal('useAppConfig', () => ({ croutonActions: { 'invitation:create': {} } }))
    const plugin = (await import('../../../server/plugins/permissions-check')).default as unknown as () => void
    expect(() => plugin()).toThrow(/'invitation:create' is a Better Auth organization permission/)
    vi.stubGlobal('useAppConfig', () => ({ croutonActions: DECLARED }))
    expect(() => plugin()).not.toThrow()
  })
})

describe('canMany() — several actions, one membership read', () => {
  it('answers each action and reads the member row once', async () => {
    setup()
    const db = (globalThis as unknown as { useDB: () => unknown }).useDB()
    const useDB = vi.fn(() => db)
    vi.stubGlobal('useDB', useDB)
    const result = await canMany(TEAM, 'u-member', ['admin:access', 'pages:edit', 'bogus'])
    expect(result).toEqual({ 'admin:access': false, 'pages:edit': false, 'bogus': false })
    expect(useDB).toHaveBeenCalledTimes(1)
  })
})

describe('can() without a request never builds the auth instance', () => {
  it('with no auth instance yet, answers from the static roles and leaves auth unbuilt', async () => {
    const access = buildAccessControl({ actions: DECLARED, roles: { member: ['pages:edit'] } })
    setAccessControl(access)
    setAuthInstance(null as never)
    expect(isAuthInitialized()).toBe(false)
    expect(await can(TEAM, 'u-member', 'pages:edit')).toBe(true)
    expect(await can(TEAM, 'u-member', 'site:manage')).toBe(false)
    expect(await can(TEAM, 'u-owner', 'team:manage')).toBe(true)
    expect(isAuthInitialized()).toBe(false)
  })
})

describe('can() — a site config grants an action to another base role (T2)', () => {
  it('member with pages:edit can pages:edit, not collections:manage, and reaches admin:access', async () => {
    setup({ member: ['pages:edit'] })
    expect(await can(TEAM, 'u-member', 'pages:edit')).toBe(true)
    expect(await can(TEAM, 'u-member', 'collections:manage')).toBe(false)
    expect(await can(TEAM, 'u-member', 'admin:access')).toBe(true)
  })

  it('a plain member (only Better Auth\'s own ac:read) does not reach admin:access', async () => {
    setup()
    expect(await can(TEAM, 'u-member', 'admin:access')).toBe(false)
  })

  it('a config role replaces that role\'s defaults; roles left out keep theirs', async () => {
    setup({ admin: ['pages:edit'] })
    expect(await can(TEAM, 'u-admin', 'pages:edit')).toBe(true)
    expect(await can(TEAM, 'u-admin', 'team:domains')).toBe(false)
    expect(await can(TEAM, 'u-owner', 'team:domains')).toBe(true)
  })
})

describe('can() — never throws (T3)', () => {
  it('an unknown or malformed action answers false', async () => {
    setup()
    expect(await can(TEAM, 'u-owner', 'nope:x')).toBe(false)
    expect(await can(TEAM, 'u-owner', 'not-an-action')).toBe(false)
    expect(await can(TEAM, 'u-owner', '')).toBe(false)
    // A Better Auth statement is not a crouton action.
    expect(await can(TEAM, 'u-owner', 'member:create')).toBe(false)
  })

  it('a non-member, or a member of another team, answers false', async () => {
    setup()
    expect(await can(TEAM, 'u-stranger', 'pages:edit')).toBe(false)
    expect(await can(OTHER_TEAM, 'u-owner', 'pages:edit')).toBe(false)
  })

  it('a membership lookup that throws answers false', async () => {
    setup()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.stubGlobal('useDB', () => { throw new Error('D1 down') })
    await expect(can(TEAM, 'u-owner', 'pages:edit')).resolves.toBe(false)
  })
})

describe('can() — no session needed (T4)', () => {
  it('answers from team id + user id alone, reading the role from the member table', async () => {
    setup()
    expect(await can(TEAM, 'u-admin', 'team:manage')).toBe(true)
    sqlite.prepare('UPDATE member SET role = ? WHERE userId = ?').run('member', 'u-admin')
    expect(await can(TEAM, 'u-admin', 'team:manage')).toBe(false)
  })
})

describe('owner keeps team:manage (T6)', () => {
  const message = /teams\.roles\.owner must include 'team:manage'/

  it('a config without team:manage for the owner fails with a clear message', () => {
    expect(() => validateBaseRoles({ owner: ['pages:edit'] })).toThrow(message)
    expect(() => buildAccessControl({ roles: { owner: [] } })).toThrow(message)
  })

  it('the startup plugin refuses that config at boot', async () => {
    vi.stubGlobal('defineNitroPlugin', (fn: () => void) => fn)
    vi.stubGlobal('useRuntimeConfig', () => ({ public: { crouton: { auth: { teams: { roles: { owner: ['pages:edit'] } } } } } }))
    vi.stubGlobal('useAppConfig', () => ({}))
    const plugin = (await import('../../../server/plugins/permissions-check')).default as unknown as () => void
    expect(() => plugin()).toThrow(message)
    vi.stubGlobal('useRuntimeConfig', () => ({ public: { crouton: { auth: {} } } }))
    expect(() => plugin()).not.toThrow()
  })

  it('the default config, and one that leaves owner out, do not throw', () => {
    expect(() => validateBaseRoles(undefined)).not.toThrow()
    expect(() => validateBaseRoles({ member: ['pages:edit'] })).not.toThrow()
    expect(() => buildAccessControl({})).not.toThrow()
  })

  it('an unknown base role is refused', () => {
    expect(() => validateBaseRoles({ editor: ['pages:edit'] } as never)).toThrow(/not a base role/)
  })
})
