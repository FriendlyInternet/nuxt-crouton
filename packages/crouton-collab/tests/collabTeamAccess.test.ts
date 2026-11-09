import { describe, it, expect, vi, beforeEach } from 'vitest'

const team = vi.hoisted(() => ({ getTeamById: vi.fn(), getTeamBySlug: vi.fn(), getMembership: vi.fn() }))
vi.mock('@fyit/crouton-auth/server/utils/team', () => team)
vi.stubGlobal('createError', (e: any) => Object.assign(new Error(e.statusText ?? e.message), e))

import { requireTeamMember, roomWithinTeam, resolveTokenRoom } from '../server/utils/collabTeamAccess'

const ev = {} as any

beforeEach(() => {
  Object.values(team).forEach(f => f.mockReset())
  team.getTeamById.mockResolvedValue(null)
  team.getTeamBySlug.mockResolvedValue(null)
})

describe('roomWithinTeam', () => {
  it('strips slug or id prefix, rejects others', () => {
    expect(roomWithinTeam('acme:page-1', 'acme', 't1')).toBe('page-1')
    expect(roomWithinTeam('t1:page-1', 'acme', 't1')).toBe('page-1')
    expect(roomWithinTeam('other:page-1', 'acme', 't1')).toBeNull()
    expect(roomWithinTeam('acme:', 'acme', 't1')).toBeNull()
  })
})

describe('requireTeamMember', () => {
  it('returns the team for a member (slug lookup)', async () => {
    team.getTeamBySlug.mockResolvedValue({ id: 't1' })
    team.getMembership.mockResolvedValue({})
    expect((await requireTeamMember(ev, 'acme', 'u1')).id).toBe('t1')
  })
  it('403 for non-member', async () => {
    team.getTeamById.mockResolvedValue({ id: 't1' })
    await expect(requireTeamMember(ev, 't1', 'u1')).rejects.toMatchObject({ status: 403 })
  })
  it('403 for unknown team unless notFound requested', async () => {
    await expect(requireTeamMember(ev, 'x', 'u1')).rejects.toMatchObject({ status: 403 })
    await expect(requireTeamMember(ev, 'x', 'u1', true)).rejects.toMatchObject({ status: 404 })
  })
})

describe('resolveTokenRoom', () => {
  it('400 when params missing', async () => {
    await expect(resolveTokenRoom(ev, { teamId: 'a' }, 'u1')).rejects.toMatchObject({ status: 400 })
  })
  it('canonicalises the room key to the team id', async () => {
    team.getTeamBySlug.mockResolvedValue({ id: 't1' })
    team.getMembership.mockResolvedValue({})
    expect(await resolveTokenRoom(ev, { teamId: 'acme', room: 'acme:page-1' }, 'u1'))
      .toEqual({ teamId: 't1', roomKey: 't1:page-1' })
  })
  it('403 for a room outside the team', async () => {
    team.getTeamById.mockResolvedValue({ id: 't1' })
    team.getMembership.mockResolvedValue({})
    await expect(resolveTokenRoom(ev, { teamId: 't1', room: 'zzz:page' }, 'u1')).rejects.toMatchObject({ status: 403 })
  })
})
