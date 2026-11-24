// @vitest-environment node
/**
 * T1 (#4105) — the `can` page middleware (real file) lets a navigation through
 * only when every matched route record's `meta.can` is allowed.
 *
 * The middleware asks GET /api/teams/[team]/can through `useRequestFetch()`.
 * Here that fetch is answered by the REAL `canMany()` against a real Better
 * Auth instance (memory adapter) and a real SQLite `member` table, set up the
 * way tests/unit/server/permissions.test.ts does — so a site config that grants
 * an action to `member` changes the outcome exactly as it would deployed. The
 * endpoint's own cookie → session → membership step is covered by
 * tests/unit/server/can-endpoint.test.ts; it is modelled here by a 403 for a
 * non-member. The Nuxt runtime (session, router helpers) is stubbed.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'
import { ref, watch } from 'vue'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { betterAuth } from 'better-auth'
import { memoryAdapter } from 'better-auth/adapters/memory'
import { organization } from 'better-auth/plugins'
import * as authSchema from '../../server/database/schema/auth'
import { buildOrganizationConfig, setAuthInstance } from '../../server/lib/auth'
import { buildAccessControl, setAccessControl, type BaseRolesConfig, type CroutonActionRegistry } from '../../server/lib/access'
import { canMany } from '../../server/utils/permissions'
import { getOrganizationMembershipDirect } from '../../server/utils/team'

vi.mock('nitropack/runtime', () => ({
  useNitroApp: () => ({ hooks: { callHook: vi.fn().mockResolvedValue(undefined) } })
}))

const TEAM = 'team-1'

const DECLARED: CroutonActionRegistry = {
  'admin:access': {},
  'team:manage': {},
  'team:domains': {},
  'site:manage': {},
  'collections:manage': {},
  'translations:manage': {},
  'pages:edit': {},
  'media:manage': {},
  'activity:view': {},
  'bookings:create': {},
  'bookings:manage': {},
  'sales:manage': {}
}

/** The routes this ticket guards, as vue-router matches them (parent first). */
const team = { meta: { can: 'admin:access' } }
const ROUTES: Record<string, Array<{ meta: Record<string, unknown> }>> = {
  'admin home': [{ meta: { can: 'admin:access' } }],
  'team/index': [team, { meta: { can: 'team:manage' } }],
  'team/settings': [team, { meta: { can: 'team:manage' } }],
  'team/invitations': [team, { meta: { can: 'team:manage' } }],
  'team/email-logs': [team, { meta: { can: 'team:manage' } }],
  'team/email-templates': [team, { meta: { can: 'team:manage' } }],
  'team/site-info': [team, { meta: { can: 'site:manage' } }],
  'team/look-and-feel': [team, { meta: { can: 'site:manage' } }],
  'team/redirects': [team, { meta: { can: 'site:manage' } }],
  'team/domains': [team, { meta: { can: 'team:domains' } }],
  'media': [{ meta: { can: 'media:manage' } }],
  'crouton/[collection]': [{ meta: { can: 'collections:manage' } }],
  'translations': [{ meta: { can: 'translations:manage' } }],
  'activity': [{ meta: { can: 'activity:view' } }],
  'workspace': [{ meta: { can: 'pages:edit' } }]
}
const route = (name: string, extra: Record<string, unknown> = {}) => ({
  fullPath: `/admin/${TEAM}/${name}`,
  params: { team: TEAM },
  matched: ROUTES[name]!,
  ...extra
})

let sqlite: Database.Database
let currentUser: { id: string, superAdmin?: boolean } | null
const navigateTo = vi.fn((to: unknown) => ({ redirectedTo: to }))
const plainFetch = vi.fn()
const switchTeamBySlug = vi.fn()
/** The team a `/api/teams/<id>/can` request asks about, and who asks; 401 if either is missing. */
function canCaller(url: string): { teamId: string, userId: string } {
  const teamId = url.match(/^\/api\/teams\/([^/]+)\/can$/)?.[1]
  if (!teamId || !currentUser) throw Object.assign(new Error('Unauthorized'), { statusCode: 401 })
  return { teamId, userId: currentUser.id }
}
const requestFetch = vi.fn(async (url: string, opts: { query: { actions: string } }) => {
  const { teamId, userId } = canCaller(url)
  // resolveTeamAndCheckMembership: a non-member gets a 403
  if (!await getOrganizationMembershipDirect(teamId, userId)) {
    throw Object.assign(new Error('Forbidden'), { statusCode: 403 })
  }
  return await canMany(teamId, userId, opts.query.actions.split(','))
})

/**
 * Nuxt's instance is only reachable while the middleware runs SYNCHRONOUSLY
 * (callWithNuxt sets it, calls the function, unsets it on return) or inside
 * `nuxtApp.runWithContext`. A composable reached after an `await` in a plain
 * helper throws on the server — that is what made every velo admin page 401
 * on the PR #4151 preview. The stubs below enforce the same rule.
 */
let nuxtActive = false
function inNuxt<T>(fn: () => T): T {
  const prev = nuxtActive
  nuxtActive = true
  try {
    return fn()
  }
  finally {
    nuxtActive = prev
  }
}
function composable<A extends unknown[], R>(name: string, fn: (...args: A) => R) {
  return (...args: A): R => {
    if (!nuxtActive) throw new Error(`[nuxt] instance unavailable (${name} called outside the Nuxt context)`)
    return fn(...args)
  }
}

let loadedMiddleware: (to: unknown) => Promise<unknown>
/** The middleware as Nuxt calls it: inside the context for its synchronous part only. */
const middleware = (to: unknown) => inNuxt(() => loadedMiddleware(to))

function config(roles?: BaseRolesConfig) {
  const access = buildAccessControl({ actions: DECLARED, roles })
  setAccessControl(access)
  setAuthInstance(betterAuth({
    database: memoryAdapter({ user: [], session: [], account: [], verification: [], organization: [], member: [], invitation: [], organizationRole: [] }),
    secret: 'test-secret-test-secret-test-secret-123',
    baseURL: 'https://velo.pmcp.dev',
    plugins: [organization(buildOrganizationConfig({ teams: { roles } }, undefined, access) as never)]
  }) as never)
}

function stubRuntime() {
  vi.stubGlobal('defineNuxtRouteMiddleware', (fn: unknown) => fn)
  vi.stubGlobal('watch', watch)
  vi.stubGlobal('useSession', composable('useSession', () => ({
    data: ref(currentUser ? { user: currentUser } : null),
    isPending: ref(false),
    isAuthenticated: ref(!!currentUser)
  })))
  vi.stubGlobal('useTeam', composable('useTeam', () => ({ switchTeamBySlug })))
  vi.stubGlobal('useNuxtApp', composable('useNuxtApp', () => ({ runWithContext: inNuxt })))
  vi.stubGlobal('navigateTo', composable('navigateTo', navigateTo))
  vi.stubGlobal('createError', (o: { status: number, statusText?: string, message?: string }) =>
    Object.assign(new Error(o.message), { statusCode: o.status, statusMessage: o.statusText }))
  vi.stubGlobal('useRequestFetch', composable('useRequestFetch', () => requestFetch))
  vi.stubGlobal('$fetch', plainFetch)
}

async function outcome(name: string, user: string, extra?: Record<string, unknown>) {
  currentUser = { id: user }
  try {
    await middleware(route(name, extra))
    return 'allowed'
  }
  catch (e) {
    return (e as { statusCode?: number }).statusCode
  }
}

beforeAll(async () => {
  stubRuntime()
  loadedMiddleware = (await import('../../app/middleware/can')).default as never
})

beforeEach(() => {
  stubRuntime()
  sqlite = new Database(':memory:')
  sqlite.exec('CREATE TABLE `member` (`id` text PRIMARY KEY NOT NULL, `userId` text NOT NULL, `organizationId` text NOT NULL, `role` text DEFAULT \'member\' NOT NULL, `createdAt` integer NOT NULL)')
  const insert = sqlite.prepare('INSERT INTO member (id, userId, organizationId, role, createdAt) VALUES (?, ?, ?, ?, ?)')
  insert.run('m1', 'u-owner', TEAM, 'owner', Date.now())
  insert.run('m2', 'u-admin', TEAM, 'admin', Date.now())
  insert.run('m3', 'u-member', TEAM, 'member', Date.now())
  vi.stubGlobal('useDB', () => drizzle(sqlite, { schema: authSchema }))
  vi.spyOn(console, 'error').mockImplementation(() => {})
  requestFetch.mockClear()
  plainFetch.mockClear()
  navigateTo.mockClear()
  currentUser = null
})

afterEach(() => {
  sqlite.close()
  setAccessControl(null)
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('can middleware (#4105)', () => {
  it('T1 no config → owner and admin open every guarded page, member none', async () => {
    config()
    for (const name of Object.keys(ROUTES)) {
      expect(await outcome(name, 'u-owner'), `owner ${name}`).toBe('allowed')
      expect(await outcome(name, 'u-admin'), `admin ${name}`).toBe('allowed')
      expect(await outcome(name, 'u-member'), `member ${name}`).toBe(403)
    }
  })

  it('T2 member granted pages:edit opens the page editor and the admin home, nothing else', async () => {
    config({ member: ['pages:edit'] })
    const opened = []
    for (const name of Object.keys(ROUTES)) {
      if (await outcome(name, 'u-member') === 'allowed') opened.push(name)
    }
    expect(opened.sort()).toEqual(['admin home', 'workspace'])
  })

  it('T3 member granted site:manage opens site-info, look-and-feel, redirects (parent passes on admin:access), not settings or domains', async () => {
    config({ member: ['site:manage'] })
    expect(await outcome('team/site-info', 'u-member')).toBe('allowed')
    expect(await outcome('team/look-and-feel', 'u-member')).toBe('allowed')
    expect(await outcome('team/redirects', 'u-member')).toBe('allowed')
    expect(await outcome('team/settings', 'u-member')).toBe(403)
    expect(await outcome('team/domains', 'u-member')).toBe(403)
  })

  it('reads every matched record: a child action that passes does not hide a parent action that fails', async () => {
    config({ member: ['site:manage'] })
    // parent needs team:manage, child site:manage — member has only site:manage
    const matched = [{ meta: { can: 'team:manage' } }, { meta: { can: 'site:manage' } }]
    expect(await outcome('team/site-info', 'u-member', { matched })).toBe(403)
    expect(requestFetch).toHaveBeenLastCalledWith(`/api/teams/${TEAM}/can`, { query: { actions: 'team:manage,site:manage' } })
  })

  it('T4 a refusal is a 403 naming the action', async () => {
    config()
    currentUser = { id: 'u-member' }
    await expect(middleware(route('workspace'))).rejects.toMatchObject({ statusCode: 403, message: 'Not allowed: pages:edit' })
  })

  it('T5 the server render asks through useRequestFetch (cookie forwarded), not $fetch', async () => {
    config()
    expect(await outcome('workspace', 'u-admin')).toBe('allowed')
    expect(requestFetch).toHaveBeenCalledWith(`/api/teams/${TEAM}/can`, { query: { actions: 'pages:edit' } })
    expect(plainFetch).not.toHaveBeenCalled()
  })

  it('a non-member is refused with 403', async () => {
    config()
    expect(await outcome('admin home', 'u-stranger')).toBe(403)
  })

  it('a super-admin skips the check', async () => {
    config()
    currentUser = { id: 'u-stranger', superAdmin: true }
    await expect(middleware(route('team/domains'))).resolves.toBeUndefined()
    expect(requestFetch).not.toHaveBeenCalled()
  })

  it('a page that names no action is refused (403), not let through', async () => {
    config()
    expect(await outcome('admin home', 'u-owner', { matched: [{ meta: {} }] })).toBe(403)
    expect(requestFetch).not.toHaveBeenCalled()
  })

  it('an owner and an admin pass even though the check awaits the session first (no 401 from a lost Nuxt context)', async () => {
    config()
    // A session still loading forces a real await before the fetch, like a first load.
    const isPending = ref(true)
    vi.stubGlobal('useSession', composable('useSession', () => ({
      data: ref({ user: currentUser }),
      isPending,
      isAuthenticated: ref(true)
    })))
    for (const user of ['u-owner', 'u-admin']) {
      isPending.value = true
      currentUser = { id: user }
      const run = middleware(route('team/domains'))
      isPending.value = false
      await expect(run, user).resolves.toBeUndefined()
    }
    expect(requestFetch).toHaveBeenCalledTimes(2)
  })

  it('signed out → sent to login with a redirect back', async () => {
    config()
    currentUser = null
    await middleware(route('workspace'))
    expect(navigateTo).toHaveBeenCalledWith({ path: '/auth/login', query: { redirect: `/admin/${TEAM}/workspace` } })
  })
})
