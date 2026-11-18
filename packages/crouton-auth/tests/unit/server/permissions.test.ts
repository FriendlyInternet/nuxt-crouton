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
import { buildOrganizationConfig, setAuthInstance } from '../../../server/lib/auth'
import {
  buildAccessControl,
  setAccessControl,
  validateBaseRoles,
  CROUTON_DEFAULT_ACTIONS,
  type BaseRolesConfig
} from '../../../server/lib/access'
import { can } from '../../../server/utils/permissions'

vi.mock('nitropack/runtime', () => ({
  useNitroApp: () => ({ hooks: { callHook: vi.fn().mockResolvedValue(undefined) } })
}))

const TEAM = 'team-1'
const OTHER_TEAM = 'team-2'

let sqlite: Database.Database

/** Wire a real Better Auth + access control the way createAuth() does. */
function setup(roles?: BaseRolesConfig) {
  const access = buildAccessControl({
    // What the four approved packages declare in their app.config (#4104).
    actions: {
      'admin:access': { label: 'permissions.adminAccess' },
      'team:manage': { label: 'permissions.teamManage' },
      'team:domains': { label: 'permissions.teamDomains' },
      'site:manage': { label: 'permissions.siteManage' },
      'collections:manage': { label: 'permissions.collectionsManage' },
      'pages:edit': { label: 'permissions.pagesEdit' }
    },
    roles
  })
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
    expect(CROUTON_DEFAULT_ACTIONS).toHaveLength(12)
    for (const action of CROUTON_DEFAULT_ACTIONS) {
      expect(await can(TEAM, 'u-owner', action), `owner ${action}`).toBe(true)
      expect(await can(TEAM, 'u-admin', action), `admin ${action}`).toBe(true)
      expect(await can(TEAM, 'u-member', action), `member ${action}`).toBe(false)
    }
  })

  it('actions an unapproved package has not declared yet still follow the defaults', async () => {
    setup()
    // bookings/sales/i18n/assets/events declare theirs in a follow-up; crouton-auth knows them already.
    expect(await can(TEAM, 'u-admin', 'bookings:manage')).toBe(true)
    expect(await can(TEAM, 'u-member', 'bookings:manage')).toBe(false)
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
