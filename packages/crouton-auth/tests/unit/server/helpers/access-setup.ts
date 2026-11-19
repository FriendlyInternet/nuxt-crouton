/**
 * A real Better Auth + access control, wired the way createAuth() does, and a
 * real SQLite team for can() to read (#4104). Shared by permissions.test.ts and
 * route-actions.test.ts (#4108). No better-auth mock: the organization plugin
 * gets the built `ac`/`roles` through the real buildOrganizationConfig(); the
 * member's role is read by the real getOrganizationMembershipDirect().
 */
import { vi } from 'vitest'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { betterAuth } from 'better-auth'
import { memoryAdapter } from 'better-auth/adapters/memory'
import { organization } from 'better-auth/plugins'
import * as authSchema from '../../../../server/database/schema/auth'
import { buildOrganizationConfig, setAuthInstance } from '../../../../server/lib/auth'
import {
  buildAccessControl,
  setAccessControl,
  type BaseRolesConfig,
  type CroutonActionRegistry
} from '../../../../server/lib/access'
import { buildAuthHooks } from '../../../../server/lib/team-admin-role'

export const TEAM = 'team-1'
export const OTHER_TEAM = 'team-2'

/** What the packages declare in their app.config (#4104 table) — declared-actions.test.ts checks the real files. */
export const DECLARED: CroutonActionRegistry = {
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
export function setup(roles?: BaseRolesConfig, actions: CroutonActionRegistry = DECLARED) {
  const access = buildAccessControl({ actions, roles })
  setAccessControl(access)
  const auth = betterAuth({
    database: memoryAdapter({ user: [], session: [], account: [], verification: [], organization: [], member: [], invitation: [], organizationRole: [] }),
    secret: 'test-secret-test-secret-test-secret-123',
    baseURL: 'https://velo.pmcp.dev',
    plugins: [organization(buildOrganizationConfig({ teams: { roles } }, undefined, access) as never)],
    // As createAuth() wires it: admin is each team's own row (#4130).
    hooks: buildAuthHooks(access)
  })
  setAuthInstance(auth as never)
  return { access, auth }
}

/**
 * An in-memory SQLite with the `member` (and `organization`) tables: TEAM has
 * u-owner (owner), u-admin (admin) and u-member (member). Stubs the global
 * `useDB`, which team.ts reads. Close it in afterEach.
 */
export function openTeamDb(): Database.Database {
  const sqlite = new Database(':memory:')
  sqlite.exec('CREATE TABLE `member` (`id` text PRIMARY KEY NOT NULL, `userId` text NOT NULL, `organizationId` text NOT NULL, `role` text DEFAULT \'member\' NOT NULL, `createdAt` integer NOT NULL)')
  sqlite.exec('CREATE TABLE `organization` (`id` text PRIMARY KEY NOT NULL, `name` text NOT NULL, `slug` text NOT NULL, `logo` text, `metadata` text, `personal` integer DEFAULT 0 NOT NULL, `isDefault` integer DEFAULT 0 NOT NULL, `ownerId` text, `createdAt` integer NOT NULL)')
  const insert = sqlite.prepare('INSERT INTO member (id, userId, organizationId, role, createdAt) VALUES (?, ?, ?, ?, ?)')
  insert.run('m1', 'u-owner', TEAM, 'owner', Date.now())
  insert.run('m2', 'u-admin', TEAM, 'admin', Date.now())
  insert.run('m3', 'u-member', TEAM, 'member', Date.now())
  sqlite.prepare('INSERT INTO organization (id, name, slug, createdAt) VALUES (?, ?, ?, ?)').run(TEAM, 'Team 1', TEAM, Date.now())
  const db = drizzle(sqlite, { schema: authSchema })
  vi.stubGlobal('useDB', () => db)
  return sqlite
}
