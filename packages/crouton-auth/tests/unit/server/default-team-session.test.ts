/**
 * session.create.before joins the default team on every sign-in (#3786)
 *
 * In one-team apps (`teams.defaultTeamSlug`) the default-team join used to run
 * only in `user.create.after`, so an account made before the setting (or
 * removed from the team later) was activated into a team it wasn't a member
 * of and got 403 "Not a team member" on the next team-scoped request.
 *
 * Drives the real hook through the public `createAuth()` with better-auth
 * mocked (same approach as auth-config.test.ts), against a small in-memory
 * fake of the raw-SQL `db.all` / `db.run` calls the hook makes.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { CroutonAuthConfig } from '../../../types/config'

import { createAuth } from '../../../server/lib/auth'

const mockBetterAuth = vi.fn((config: unknown) => ({ config }))

vi.mock('better-auth', () => ({
  betterAuth: (config: unknown) => mockBetterAuth(config)
}))

vi.mock('better-auth/plugins', () => ({
  organization: (config: unknown) => ({ type: 'organization', config }),
  admin: (config: unknown) => ({ type: 'admin', config }),
  twoFactor: (config: unknown) => ({ type: 'twoFactor', config }),
  magicLink: (config: unknown) => ({ type: 'magicLink', config }),
  haveIBeenPwned: (config: unknown) => ({ type: 'haveIBeenPwned', config })
}))

vi.mock('@better-auth/i18n', () => ({
  i18n: (config: unknown) => ({ type: 'i18n', config })
}))

vi.mock('@better-auth/passkey', () => ({
  passkey: (config: unknown) => ({ type: 'passkey', config })
}))

vi.mock('better-auth/adapters/drizzle', () => ({
  drizzleAdapter: () => ({ type: 'drizzle' })
}))

vi.mock('nitropack/runtime', () => ({
  useNitroApp: () => ({ hooks: { callHook: vi.fn().mockResolvedValue(undefined) } })
}))

// ---------------------------------------------------------------------------
// In-memory fake db
// ---------------------------------------------------------------------------

type Org = { id: string, name: string, slug: string }
type Member = { id: string, organizationId: string, userId: string, role: string, createdAt: string }

/** Split a drizzle `sql` template into its text and its bound params. */
function flatten(query: any): { text: string, params: unknown[] } {
  let text = ''
  const params: unknown[] = []
  for (const chunk of query.queryChunks ?? []) {
    if (chunk && typeof chunk === 'object' && Array.isArray(chunk.value)) {
      text += chunk.value.join('')
    } else {
      text += '?'
      params.push(chunk)
    }
  }
  return { text: text.replace(/\s+/g, ' ').trim(), params }
}

function fakeDb(seed: { orgs?: Org[], members?: Member[] } = {}, opts: { failMemberInsert?: boolean } = {}) {
  const orgs: Org[] = [...(seed.orgs ?? [])]
  const members: Member[] = [...(seed.members ?? [])]
  const inserts: Array<{ table: 'organization' | 'member', params: unknown[] }> = []

  const db = {
    async all(query: unknown) {
      const { text, params } = flatten(query)
      if (text.includes('FROM organization WHERE slug')) {
        return orgs.filter(o => o.slug === params[0])
      }
      if (text.includes('COUNT(*)')) {
        return [{ count: members.filter(m => m.organizationId === params[0]).length }]
      }
      if (text.includes('FROM member WHERE organizationId')) {
        return members
          .filter(m => m.organizationId === params[0] && m.userId === params[1])
          .map(m => ({ id: m.id }))
      }
      if (text.includes('FROM member m')) {
        return members
          .filter(m => m.userId === params[0])
          .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
          .slice(0, 1)
          .map(m => ({ organizationId: m.organizationId }))
      }
      return []
    },
    async run(query: unknown) {
      const { text, params } = flatten(query)
      if (text.includes('INSERT INTO organization')) {
        inserts.push({ table: 'organization', params })
        const [id, name, slug] = params as string[]
        orgs.push({ id: id!, name: name!, slug: slug! })
        return
      }
      if (text.includes('INSERT INTO member')) {
        if (opts.failMemberInsert) throw new Error('D1_ERROR: database is locked')
        inserts.push({ table: 'member', params })
        const [id, organizationId, userId, role, createdAt] = params as string[]
        members.push({ id: id!, organizationId: organizationId!, userId: userId!, role: role!, createdAt: createdAt! })
      }
    }
  }

  return { db, orgs, members, inserts }
}

function sessionHook(config: CroutonAuthConfig, db: unknown) {
  createAuth({ config, db: db as never, secret: 'test-secret', baseURL: 'https://kvr.pmcp.dev' })
  const built = mockBetterAuth.mock.calls.at(-1)![0] as any
  return built.databaseHooks.session.create.before as (session: { userId: string }) => Promise<any>
}

const ACME: Org = { id: 'org-acme', name: 'Acme', slug: 'acme' }
const oneTeam: CroutonAuthConfig = { teams: { defaultTeamSlug: 'acme' } }
const session = { id: 'sess-1', userId: 'old-user', token: 't' }

describe('session.create.before joins the default team (#3786)', () => {
  beforeEach(() => {
    mockBetterAuth.mockClear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('adds an existing user who is not in the default team, and activates it', async () => {
    const { db, inserts, members } = fakeDb({
      orgs: [ACME],
      members: [{ id: 'm-0', organizationId: 'org-acme', userId: 'founder', role: 'owner', createdAt: '2026-01-01' }]
    })

    const result = await sessionHook(oneTeam, db)(session)

    const memberInserts = inserts.filter(i => i.table === 'member')
    expect(memberInserts).toHaveLength(1)
    expect(memberInserts[0]!.params[1]).toBe('org-acme')
    expect(members.find(m => m.userId === 'old-user')?.role).toBe('member')
    expect(result.data.activeOrganizationId).toBe('org-acme')
  })

  it('does not insert again for a user who is already a member', async () => {
    const { db, inserts } = fakeDb({
      orgs: [ACME],
      members: [{ id: 'm-1', organizationId: 'org-acme', userId: 'old-user', role: 'member', createdAt: '2026-01-01' }]
    })

    const result = await sessionHook(oneTeam, db)(session)

    expect(inserts.filter(i => i.table === 'member')).toHaveLength(0)
    expect(result.data.activeOrganizationId).toBe('org-acme')
  })

  it('writes nothing when defaultTeamSlug is unset (same as before)', async () => {
    const { db, inserts } = fakeDb({
      orgs: [ACME, { id: 'org-x', name: 'X', slug: 'x' }],
      members: [{ id: 'm-2', organizationId: 'org-x', userId: 'old-user', role: 'member', createdAt: '2026-01-01' }]
    })

    const result = await sessionHook({ teams: {} }, db)(session)

    expect(inserts).toHaveLength(0)
    expect(result.data.activeOrganizationId).toBe('org-x')
  })

  it('creates the default org when missing, then joins it and activates it', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const { db, inserts, orgs } = fakeDb()

    const result = await sessionHook(oneTeam, db)(session)

    expect(inserts.map(i => i.table)).toEqual(['organization', 'member'])
    const created = orgs.find(o => o.slug === 'acme')!
    expect(created).toBeTruthy()
    expect(inserts[1]!.params[1]).toBe(created.id)
    // First member of a fresh default org is its owner (role rule unchanged).
    expect(inserts[1]!.params[3]).toBe('owner')
    expect(result.data.activeOrganizationId).toBe(created.id)
  })

  it('logs and still creates the session when the membership write fails', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { db } = fakeDb({ orgs: [ACME] }, { failMemberInsert: true })

    const result = await sessionHook(oneTeam, db)(session)

    expect(errorSpy).toHaveBeenCalled()
    expect(String(errorSpy.mock.calls[0]![0])).toContain('old-user')
    expect(result.data.activeOrganizationId).toBe('org-acme')
  })
})
