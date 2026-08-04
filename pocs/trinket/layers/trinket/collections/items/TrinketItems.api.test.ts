// @ts-nocheck
/**
 * @crouton-generated
 * @collection items
 * @layer trinket
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
  getAllTrinketItems: vi.fn(),
  getTrinketItemsByIds: vi.fn(),
  createTrinketItem: vi.fn(),
  updateTrinketItem: vi.fn(),
  deleteTrinketItem: vi.fn(),
}))

import { resolveTeamAndCheckMembership } from '@fyit/crouton-auth/server/utils/team'
import {
  getAllTrinketItems,
  createTrinketItem,
  updateTrinketItem,
  deleteTrinketItem,
} from './server/database/queries'
import getHandler from './server/api/teams/[id]/trinket-items/index.get.ts'
import postHandler from './server/api/teams/[id]/trinket-items/index.post.ts'
import patchHandler from './server/api/teams/[id]/trinket-items/[itemId].patch.ts'
import deleteHandler from './server/api/teams/[id]/trinket-items/[itemId].delete.ts'

const TEAM = { id: 'team_1' }
const USER = { id: 'user_1' }
const MEMBERSHIP = { role: 'member' }
const VALID_BODY = {}

const authed = () => (resolveTeamAndCheckMembership as any).mockResolvedValue({ team: TEAM, user: USER, membership: MEMBERSHIP })
const unauth = () => (resolveTeamAndCheckMembership as any).mockRejectedValueOnce(Object.assign(new Error('Not a team member'), { status: 403 }))

beforeEach(() => {
  vi.clearAllMocks()
  authed()
})

describe('trinket/items API handlers (generated)', () => {

  describe('index.get', () => {
    it('rejects an unauthenticated request', async () => {
      unauth()
      await expect(getHandler({ __query: {} } as any)).rejects.toBeTruthy()
      expect(getAllTrinketItems).not.toHaveBeenCalled()
    })

    it('lists scoped to the resolved team', async () => {
      ;(getAllTrinketItems as any).mockResolvedValue([])
      await getHandler({ __query: {} } as any)
      expect(getAllTrinketItems).toHaveBeenCalled()
      // first positional arg is always the resolved team id (FK filters ride in opts)
      expect((getAllTrinketItems as any).mock.calls[0][0]).toBe(TEAM.id)
    })
  })

  describe('index.post', () => {
    it('rejects an unauthenticated request and never writes', async () => {
      unauth()
      await expect(postHandler({ __body: VALID_BODY } as any)).rejects.toBeTruthy()
      expect(createTrinketItem).not.toHaveBeenCalled()
    })

    it('creates scoped to the resolved team', async () => {
      ;(createTrinketItem as any).mockResolvedValue({ id: 'rec_1' })
      const result = await postHandler({ __body: VALID_BODY } as any)
      expect(createTrinketItem).toHaveBeenCalledWith(expect.objectContaining({ teamId: TEAM.id, owner: USER.id }))
      expect(result).toMatchObject({ id: 'rec_1' })
    })
  })

  describe('[itemId].patch', () => {
    it('400s when the id param is missing', async () => {
      await expect(patchHandler({ __params: {}, __body: {} } as any)).rejects.toMatchObject({ status: 400 })
    })

    it('rejects an unauthenticated request and never writes', async () => {
      unauth()
      await expect(patchHandler({ __params: { itemId: 'rec_1' }, __body: {} } as any)).rejects.toBeTruthy()
      expect(updateTrinketItem).not.toHaveBeenCalled()
    })

    it('updates scoped to the resolved team', async () => {
      ;(updateTrinketItem as any).mockResolvedValue({ id: 'rec_1' })
      await patchHandler({ __params: { itemId: 'rec_1' }, __body: {} } as any)
      expect(updateTrinketItem).toHaveBeenCalledWith('rec_1', TEAM.id, USER.id, expect.anything(), expect.anything())
    })

    it('propagates a not-found from the query as a 404', async () => {
      ;(updateTrinketItem as any).mockRejectedValue(Object.assign(new Error('not found'), { status: 404 }))
      await expect(patchHandler({ __params: { itemId: 'missing' }, __body: {} } as any)).rejects.toMatchObject({ status: 404 })
    })
  })

  describe('[itemId].delete', () => {
    it('400s when the id param is missing', async () => {
      await expect(deleteHandler({ __params: {} } as any)).rejects.toMatchObject({ status: 400 })
    })

    it('rejects an unauthenticated request and never writes', async () => {
      unauth()
      await expect(deleteHandler({ __params: { itemId: 'rec_1' } } as any)).rejects.toBeTruthy()
      expect(deleteTrinketItem).not.toHaveBeenCalled()
    })

    it('deletes scoped to the resolved team', async () => {
      ;(deleteTrinketItem as any).mockResolvedValue({ success: true })
      await deleteHandler({ __params: { itemId: 'rec_1' } } as any)
      expect(deleteTrinketItem).toHaveBeenCalledWith('rec_1', TEAM.id, USER.id, expect.anything())
    })

    it('propagates a not-found from the query as a 404', async () => {
      ;(deleteTrinketItem as any).mockRejectedValue(Object.assign(new Error('not found'), { status: 404 }))
      await expect(deleteHandler({ __params: { itemId: 'missing' } } as any)).rejects.toMatchObject({ status: 404 })
    })
  })
})
