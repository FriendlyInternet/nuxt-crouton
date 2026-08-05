// @ts-nocheck
/**
 * @crouton-generated
 * @collection artists
 * @layer builder
 *
 * API route handler test (#791): drives the generated endpoint handlers with a
 * mocked team-auth util + queries module and a fake H3 event. Covers what the
 * schema-smoke can't — team-scoping (unauthenticated → rejected; queries called
 * with the resolved team id) and error paths (invalid body → rejected, missing
 * id → 400, not-found → 404). Runtime-free: no Nuxt/DB, no network.
 * Regenerate with --force; suppress with --no-tests.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// The generated handlers reference Nitro/H3 auto-imports as globals. Define them
// BEFORE the route modules import (vi.hoisted runs first) so that the route's
// `export default defineEventHandler(...)` evaluates. `createError` attaches its
// fields to the thrown Error so status codes stay assertable.
vi.hoisted(() => {
  const g = globalThis as any
  g.defineEventHandler = (fn: any) => fn
  g.useServerTiming = () => ({ start: () => ({ end: () => {} }) })
  g.getQuery = (event: any) => event?.__query ?? {}
  g.getRouterParams = (event: any) => event?.__params ?? {}
  g.readBody = async (event: any) => event?.__body
  g.readValidatedBody = async (event: any, validate: any) => validate(event?.__body)
  g.createError = (err: any) => Object.assign(new Error(err?.statusText || err?.message || 'error'), err)
})

vi.mock('@fyit/crouton-auth/server/utils/team', () => ({
  resolveTeamAndCheckMembership: vi.fn(),
}))
vi.mock('./server/database/queries', () => ({
  getAllBuilderArtists: vi.fn(),
  getBuilderArtistsByIds: vi.fn(),
  createBuilderArtist: vi.fn(),
  updateBuilderArtist: vi.fn(),
  deleteBuilderArtist: vi.fn(),
}))

import { resolveTeamAndCheckMembership } from '@fyit/crouton-auth/server/utils/team'
import {
  getAllBuilderArtists,
  createBuilderArtist,
  updateBuilderArtist,
  deleteBuilderArtist,
} from './server/database/queries'
import getHandler from './server/api/teams/[id]/builder-artists/index.get.ts'
import postHandler from './server/api/teams/[id]/builder-artists/index.post.ts'
import patchHandler from './server/api/teams/[id]/builder-artists/[artistId].patch.ts'
import deleteHandler from './server/api/teams/[id]/builder-artists/[artistId].delete.ts'

const TEAM = { id: 'team_1' }
const USER = { id: 'user_1' }
const MEMBERSHIP = { role: 'member' }
const VALID_BODY = {
  name: 'sample',
  genre: 'sample',
}
const INVALID_BODY = {
  genre: 'sample',
}

const authed = () => (resolveTeamAndCheckMembership as any).mockResolvedValue({ team: TEAM, user: USER, membership: MEMBERSHIP })
const unauth = () => (resolveTeamAndCheckMembership as any).mockRejectedValueOnce(Object.assign(new Error('Not a team member'), { status: 403 }))

beforeEach(() => {
  vi.clearAllMocks()
  authed()
})

describe('builder/artists API handlers (generated)', () => {

  describe('index.get', () => {
    it('rejects an unauthenticated request', async () => {
      unauth()
      await expect(getHandler({ __query: {} } as any)).rejects.toBeTruthy()
      expect(getAllBuilderArtists).not.toHaveBeenCalled()
    })

    it('lists scoped to the resolved team', async () => {
      ;(getAllBuilderArtists as any).mockResolvedValue([])
      await getHandler({ __query: {} } as any)
      expect(getAllBuilderArtists).toHaveBeenCalled()
      // first positional arg is always the resolved team id (FK filters ride in opts)
      expect((getAllBuilderArtists as any).mock.calls[0][0]).toBe(TEAM.id)
    })
  })

  describe('index.post', () => {
    it('rejects an unauthenticated request and never writes', async () => {
      unauth()
      await expect(postHandler({ __body: VALID_BODY } as any)).rejects.toBeTruthy()
      expect(createBuilderArtist).not.toHaveBeenCalled()
    })

    it('creates scoped to the resolved team', async () => {
      ;(createBuilderArtist as any).mockResolvedValue({ id: 'rec_1' })
      const result = await postHandler({ __body: VALID_BODY } as any)
      expect(createBuilderArtist).toHaveBeenCalledWith(expect.objectContaining({ teamId: TEAM.id, owner: USER.id }))
      expect(result).toMatchObject({ id: 'rec_1' })
    })

    it('rejects an invalid body before writing', async () => {
      // required `name` omitted → readValidatedBody throws → no write happens
      await expect(postHandler({ __body: INVALID_BODY } as any)).rejects.toBeTruthy()
      expect(createBuilderArtist).not.toHaveBeenCalled()
    })
  })

  describe('[artistId].patch', () => {
    it('400s when the id param is missing', async () => {
      await expect(patchHandler({ __params: {}, __body: {} } as any)).rejects.toMatchObject({ status: 400 })
    })

    it('rejects an unauthenticated request and never writes', async () => {
      unauth()
      await expect(patchHandler({ __params: { artistId: 'rec_1' }, __body: {} } as any)).rejects.toBeTruthy()
      expect(updateBuilderArtist).not.toHaveBeenCalled()
    })

    it('updates scoped to the resolved team', async () => {
      ;(updateBuilderArtist as any).mockResolvedValue({ id: 'rec_1' })
      await patchHandler({ __params: { artistId: 'rec_1' }, __body: {} } as any)
      expect(updateBuilderArtist).toHaveBeenCalledWith('rec_1', TEAM.id, USER.id, expect.anything(), expect.anything())
    })

    it('propagates a not-found from the query as a 404', async () => {
      ;(updateBuilderArtist as any).mockRejectedValue(Object.assign(new Error('not found'), { status: 404 }))
      await expect(patchHandler({ __params: { artistId: 'missing' }, __body: {} } as any)).rejects.toMatchObject({ status: 404 })
    })
  })

  describe('[artistId].delete', () => {
    it('400s when the id param is missing', async () => {
      await expect(deleteHandler({ __params: {} } as any)).rejects.toMatchObject({ status: 400 })
    })

    it('rejects an unauthenticated request and never writes', async () => {
      unauth()
      await expect(deleteHandler({ __params: { artistId: 'rec_1' } } as any)).rejects.toBeTruthy()
      expect(deleteBuilderArtist).not.toHaveBeenCalled()
    })

    it('deletes scoped to the resolved team', async () => {
      ;(deleteBuilderArtist as any).mockResolvedValue({ success: true })
      await deleteHandler({ __params: { artistId: 'rec_1' } } as any)
      expect(deleteBuilderArtist).toHaveBeenCalledWith('rec_1', TEAM.id, USER.id, expect.anything())
    })

    it('propagates a not-found from the query as a 404', async () => {
      ;(deleteBuilderArtist as any).mockRejectedValue(Object.assign(new Error('not found'), { status: 404 }))
      await expect(deleteHandler({ __params: { artistId: 'missing' } } as any)).rejects.toMatchObject({ status: 404 })
    })
  })
})
