/**
 * #4097 T17 — the REAL team wiring (`lib/team-lookup.ts`, spread into the tool
 * deps by `lib/deps.ts`): a team named by slug is found, both lookups awaited.
 *
 * crouton-auth's team helpers are mocked: they need a live D1/SQLite (their real
 * queries run in crouton-auth's team-utils.test.ts). The mocks are async, like
 * the real `getTeamById` / `getTeamBySlug`, so an un-awaited `a ?? b` would get a
 * Promise from the first and never try the slug — and this test would fail.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const auth = vi.hoisted(() => ({
  getTeamById: vi.fn(),
  getTeamBySlug: vi.fn(),
  canEditPages: vi.fn(),
  getUserTeamsDirect: vi.fn()
}))

vi.mock('@fyit/crouton-auth/server/utils/team', () => auth)

import { pagesTeamDeps } from '../server/mcp-pages/lib/team-lookup'

const event = { __event: true }
const team = { id: 'team_1', slug: 'velo-team', name: 'Velo', personal: false, isDefault: false }

beforeEach(() => {
  vi.stubGlobal('useEvent', () => event)
  auth.getTeamById.mockReset().mockImplementation(async (_e: unknown, id: string) => (id === team.id ? team : null))
  auth.getTeamBySlug.mockReset().mockImplementation(async (_e: unknown, slug: string) => (slug === team.slug ? team : null))
  auth.canEditPages.mockReset().mockResolvedValue(true)
  auth.getUserTeamsDirect.mockReset().mockResolvedValue([{ id: 'team_1', slug: 'velo-team', name: 'Velo', role: 'admin' }])
})
afterEach(() => vi.unstubAllGlobals())

// covers: T17
describe('pagesTeamDeps (real team wiring)', () => {
  it('finds a team by slug when the id lookup finds nothing', async () => {
    expect(await pagesTeamDeps().findTeam('velo-team')).toEqual({ id: 'team_1', slug: 'velo-team', name: 'Velo' })
    expect(auth.getTeamById).toHaveBeenCalledWith(event, 'velo-team')
    expect(auth.getTeamBySlug).toHaveBeenCalledWith(event, 'velo-team')
  })

  it('finds a known id without calling getTeamBySlug', async () => {
    expect(await pagesTeamDeps().findTeam('team_1')).toEqual({ id: 'team_1', slug: 'velo-team', name: 'Velo' })
    expect(auth.getTeamBySlug).not.toHaveBeenCalled()
  })

  it('unknown in both → null', async () => {
    expect(await pagesTeamDeps().findTeam('nope')).toBeNull()
  })

  it('canEditPages and listUserTeams pass through to crouton-auth', async () => {
    const deps = pagesTeamDeps()
    expect(await deps.canEditPages('team_1', 'user_1')).toBe(true)
    expect(auth.canEditPages).toHaveBeenCalledWith('team_1', 'user_1')
    expect(await deps.listUserTeams('user_1')).toEqual([{ id: 'team_1', slug: 'velo-team', name: 'Velo', role: 'admin' }])
    expect(auth.getUserTeamsDirect).toHaveBeenCalledWith('user_1')
  })
})
