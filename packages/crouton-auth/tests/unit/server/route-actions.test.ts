// @vitest-environment node
/**
 * Every moved server route asks an ACTION, never a role name (#4108, T1).
 *
 * The rule: with no site config every API answers as before — owner and admin
 * yes, member no — except custom domains (`team:domains`), which admins may now
 * manage too (owner decision, 18 Nov 14:11).
 *
 * Three layers, one per describe group:
 * 1. Each route's source asks exactly the action in the #4108 table (and no
 *    role-name check is left in it).
 * 2. The REAL can() — real Better Auth + real SQLite member rows
 *    (helpers/access-setup.ts) — answers owner yes / admin yes / member no for
 *    every action the table names.
 * 3. crouton-auth's own guarded routes run end to end through the REAL
 *    requireCan(): the handler is called with a request for each member, so
 *    `domains/*` refusing an admin (the old requireTeamOwner) would fail here.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import type Database from 'better-sqlite3'
import { setAccessControl } from '../../../server/lib/access'
import { setAuthInstance } from '../../../server/lib/auth'
import { can } from '../../../server/utils/permissions'
import { TEAM, openTeamDb, setup } from './helpers/access-setup'

const PACKAGES = resolve(__dirname, '../../../..')

// ── the request the real requireCan() reads ──────────────────────────────────
const session = vi.hoisted(() => ({ userId: 'u-owner', auth: null as any }))
vi.mock('nitropack/runtime', () => ({
  useNitroApp: () => ({ hooks: { callHook: vi.fn().mockResolvedValue(undefined) } })
}))
vi.mock('../../../server/utils/useServerAuth', () => ({
  requireServerSession: async () => ({ user: { id: session.userId }, session: { activeOrganizationId: null } }),
  getServerSession: async () => ({ user: { id: session.userId }, session: { activeOrganizationId: null } }),
  useServerAuth: () => ({ $context: session.auth.$context })
}))
// The handlers' own data reads (domains, e-mail logs) are not what this test is about.
vi.mock('../../../server/utils/database', () => {
  const rows = (): any => {
    const chain: any = Promise.resolve([])
    for (const k of ['from', 'where', 'innerJoin', 'groupBy', 'orderBy', 'limit', 'offset']) chain[k] = () => rows()
    return chain
  }
  const col = new Proxy({}, { get: (_t, k) => String(k) })
  return {
    useDB: () => ({ select: () => rows() }),
    tables: new Proxy({}, { get: () => col }),
    eq: () => true, and: () => true, inArray: () => true, desc: () => 0, count: () => 0
  }
})

// ── the #4108 table: route → the action it must ask ───────────────────────────
type Row = [file: string, action: string]
const T = (pkg: string, rows: Row[]) => rows.map(([f, a]) => [`${pkg}/${f}`, a] as Row)

/** Every `[<x>Id].patch.ts` / `[<x>Id].delete.ts` a package's generated collections ship. */
function collectionWrites(pkg: string, action: string): Row[] {
  const out: Row[] = []
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name)
      if (statSync(p).isDirectory()) walk(p)
      else if (/^\[\w+Id\]\.(patch|delete)\.ts$/.test(name) && p.includes(`${join('server', 'api', 'teams')}`)) out.push([relative(PACKAGES, p), action])
    }
  }
  walk(join(PACKAGES, pkg, 'collections'))
  return out
}

const GROUPS: Record<string, Row[]> = {
  auth: T('crouton-auth/server/api', [
    ['teams/[id]/domains/index.get.ts', 'team:domains'],
    ['teams/[id]/domains/index.post.ts', 'team:domains'],
    ['teams/[id]/domains/[domainId].delete.ts', 'team:domains'],
    ['teams/[id]/domains/[domainId]/verify.post.ts', 'team:domains'],
    ['teams/[id]/domains/[domainId]/set-primary.post.ts', 'team:domains'],
    ['teams/[id]/email-logs/index.get.ts', 'team:manage'],
    ['teams/[id]/email-logs/stats.get.ts', 'team:manage'],
    ['auth/invitations/[id]/resend.post.ts', 'team:manage']
  ]),
  admin: T('crouton-admin/server/api/teams/[id]/settings', [
    ['email.get.ts', 'team:manage'],
    ['email.patch.ts', 'team:manage']
  ]),
  core: T('crouton-core/server/api', [
    ['teams/[id]/crouton-redirects/index.post.ts', 'site:manage'],
    ['teams/[id]/crouton-redirects/[redirectId].patch.ts', 'site:manage'],
    ['teams/[id]/crouton-redirects/[redirectId].delete.ts', 'site:manage'],
    ['teams/[id]/settings/site.patch.ts', 'site:manage'],
    ['teams/[id]/settings/theme.patch.ts', 'site:manage'],
    ['upload-image.delete.ts', 'collections:manage']
  ]),
  i18n: T('crouton-i18n/server/api/teams/[id]', [
    ['translations-ui/index.post.ts', 'translations:manage'],
    ['translations-ui/[translationId].patch.ts', 'translations:manage'],
    ['translations-ui/[translationId].delete.ts', 'translations:manage'],
    ['settings/translations.patch.ts', 'translations:manage']
  ]),
  events: T('crouton-events/server/api/teams/[id]', [
    ['crouton-events/index.get.ts', 'activity:view'],
    ['crouton-events/export.get.ts', 'activity:view'],
    ['crouton-operations/index.get.ts', 'activity:view']
  ]),
  pages: [
    ...T('crouton-pages/server/api/teams/[id]', [
      ['pages.get.ts', 'admin:access'],
      ['pages/[...slug].get.ts', 'admin:access'],
      ['pages/[pageId]/access-code.ts', 'pages:edit']
    ]),
    ...T('crouton-pages/collections/pages/server/api/teams/[id]/pages-pages', [
      ['[pageId].patch.ts', 'pages:edit'],
      ['[pageId].delete.ts', 'pages:edit'],
      ['[pageId]/move.patch.ts', 'pages:edit'],
      ['reorder.patch.ts', 'pages:edit']
    ])
  ],
  bookings: [
    ...T('crouton-bookings/server/api/crouton-bookings/teams/[id]', [
      ['admin-bookings.get.ts', 'bookings:manage'],
      ['bookings/[bookingId]/index.patch.ts', 'bookings:manage'],
      ['bookings/[bookingId]/resend-email.post.ts', 'bookings:manage']
    ]),
    ...T('crouton-bookings/collections', [
      ['bookings/server/api/teams/[id]/bookings-bookings/index.post.ts', 'bookings:create'],
      ['bookings/server/api/teams/[id]/bookings-bookings/index.get.ts', 'bookings:manage'],
      ['emaillogs/server/api/teams/[id]/bookings-emaillogs/index.get.ts', 'bookings:manage'],
      ['emaillogs/server/api/teams/[id]/bookings-emaillogs/index.post.ts', 'bookings:manage'],
      ['emailtemplates/server/api/teams/[id]/bookings-emailtemplates/index.post.ts', 'bookings:manage'],
      ['locations/server/api/teams/[id]/bookings-locations/index.post.ts', 'bookings:manage'],
      ['settings/server/api/teams/[id]/bookings-settings/index.post.ts', 'bookings:manage']
    ]),
    ...collectionWrites('crouton-bookings', 'bookings:manage')
  ],
  sales: [
    ...T('crouton-sales/server/api/crouton-sales/teams/[id]/events/[eventId]', [
      ['orders.delete.ts', 'sales:manage'],
      ['orders/[orderId].delete.ts', 'sales:manage'],
      ['orders/[orderId]/cancel.post.ts', 'sales:manage']
    ]),
    ...collectionWrites('crouton-sales', 'collections:manage')
  ],
  assets: collectionWrites('crouton-assets', 'collections:manage')
}

const ROLE_NAME = /role\s*(===|!==)\s*'(owner|admin)'|\['admin', ?'owner'\]|\['owner', ?'admin'\]|isTeamAdmin|requireTeamRole\(event|requireTeamAdmin|requireTeamOwner/
const ASKED = /requireCan\(event, '([^']+)'\)|\bcan\([^()]*?'([a-z][a-z0-9-]*:[a-z][a-z0-9-]*)'/g

/** The actions a route's source asks requireCan / can for. */
function askedActions(file: string): string[] {
  const src = readFileSync(join(PACKAGES, file), 'utf8')
  return [...src.matchAll(ASKED)].map(m => m[1] ?? m[2])
}

const ALL_ACTIONS = [...new Set(Object.values(GROUPS).flat().map(([, a]) => a))].sort()

let sqlite: Database.Database
beforeEach(() => {
  sqlite = openTeamDb()
  session.auth = setup().auth
})
afterEach(() => {
  sqlite.close()
  setAccessControl(null)
  setAuthInstance(null as never)
  vi.unstubAllGlobals()
})

describe('every moved route asks the #4108 action (source)', () => {
  for (const [group, rows] of Object.entries(GROUPS)) {
    describe(group, () => {
      it('has routes to check', () => {
        expect(rows.length).toBeGreaterThan(0)
      })
      for (const [file, action] of rows) {
        it(`${file} asks ${action}, no role name`, () => {
          const asked = askedActions(file)
          expect(asked.length, `${file} asks no action`).toBeGreaterThan(0)
          expect(new Set(asked)).toEqual(new Set([action]))
          expect(readFileSync(join(PACKAGES, file), 'utf8')).not.toMatch(ROLE_NAME)
        })
      }
    })
  }
})

describe('the real can() answers each action like the old role checks (no config)', () => {
  it('covers the whole table', () => {
    expect(ALL_ACTIONS).toEqual([
      'activity:view', 'admin:access', 'bookings:create', 'bookings:manage', 'collections:manage',
      'pages:edit', 'sales:manage', 'site:manage', 'team:domains', 'team:manage', 'translations:manage'
    ])
  })
  for (const action of ALL_ACTIONS) {
    it(`${action}: owner yes, admin yes, member no`, async () => {
      expect(await can(TEAM, 'u-owner', action)).toBe(true)
      expect(await can(TEAM, 'u-admin', action)).toBe(true)
      expect(await can(TEAM, 'u-member', action)).toBe(false)
    })
  }
})

describe("crouton-auth's routes through the real requireCan()", () => {
  const event = () => ({ context: { params: { id: TEAM, domainId: 'd1' } }, node: { req: { headers: {} } } }) as any
  const status = (p: Promise<unknown>) => p.then(() => 200, (e: any) => e?.statusCode ?? e?.status)
  const run = async (file: string, userId: string) => {
    vi.stubGlobal('defineEventHandler', (fn: any) => fn)
    session.userId = userId
    const handler = (await import(/* @vite-ignore */ join(PACKAGES, file))).default as (e: unknown) => Promise<unknown>
    return status(handler(event()))
  }

  for (const file of ['crouton-auth/server/api/teams/[id]/domains/index.get.ts', 'crouton-auth/server/api/teams/[id]/email-logs/stats.get.ts']) {
    it(`${file}: owner and admin pass, member 403`, async () => {
      expect(await run(file, 'u-owner')).toBe(200)
      expect(await run(file, 'u-admin')).toBe(200)
      expect(await run(file, 'u-member')).toBe(403)
    })
  }

  it('custom domains now let an admin in (was owner-only, decision 18 Nov 14:11)', async () => {
    expect(await run('crouton-auth/server/api/teams/[id]/domains/index.get.ts', 'u-admin')).toBe(200)
  })
})
