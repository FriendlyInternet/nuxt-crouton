// @ts-nocheck
/**
 * @crouton-generated
 * @collection snippets
 * @layer main
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
  getAllMainSnippets: vi.fn(),
  getMainSnippetsByIds: vi.fn(),
  createMainSnippet: vi.fn(),
  updateMainSnippet: vi.fn(),
  deleteMainSnippet: vi.fn(),
}))

import { resolveTeamAndCheckMembership } from '@fyit/crouton-auth/server/utils/team'
import {
  getAllMainSnippets,
  createMainSnippet,
  updateMainSnippet,
  deleteMainSnippet,
} from './server/database/queries'
import getHandler from './server/api/teams/[id]/main-snippets/index.get.ts'
import postHandler from './server/api/teams/[id]/main-snippets/index.post.ts'
import patchHandler from './server/api/teams/[id]/main-snippets/[snippetId].patch.ts'
import deleteHandler from './server/api/teams/[id]/main-snippets/[snippetId].delete.ts'

const TEAM = { id: 'team_1' }
const USER = { id: 'user_1' }
const MEMBERSHIP = { role: 'member' }
const VALID_BODY = {
  title: 'sample',
  code: 'sample',
}
const INVALID_BODY = {
  code: 'sample',
}

const authed = () => (resolveTeamAndCheckMembership as any).mockResolvedValue({ team: TEAM, user: USER, membership: MEMBERSHIP })
const unauth = () => (resolveTeamAndCheckMembership as any).mockRejectedValueOnce(Object.assign(new Error('Not a team member'), { status: 403 }))

beforeEach(() => {
  vi.clearAllMocks()
  authed()
})

describe('main/snippets API handlers (generated)', () => {

  describe('index.get', () => {
    it('rejects an unauthenticated request', async () => {
      unauth()
      await expect(getHandler({ __query: {} } as any)).rejects.toBeTruthy()
      expect(getAllMainSnippets).not.toHaveBeenCalled()
    })

    it('lists scoped to the resolved team', async () => {
      ;(getAllMainSnippets as any).mockResolvedValue([])
      await getHandler({ __query: {} } as any)
      expect(getAllMainSnippets).toHaveBeenCalled()
      // first positional arg is always the resolved team id (FK filters ride in opts)
      expect((getAllMainSnippets as any).mock.calls[0][0]).toBe(TEAM.id)
    })
  })

  describe('index.post', () => {
    it('rejects an unauthenticated request and never writes', async () => {
      unauth()
      await expect(postHandler({ __body: VALID_BODY } as any)).rejects.toBeTruthy()
      expect(createMainSnippet).not.toHaveBeenCalled()
    })

    it('creates scoped to the resolved team', async () => {
      ;(createMainSnippet as any).mockResolvedValue({ id: 'rec_1' })
      const result = await postHandler({ __body: VALID_BODY } as any)
      expect(createMainSnippet).toHaveBeenCalledWith(expect.objectContaining({ teamId: TEAM.id, owner: USER.id }))
      expect(result).toMatchObject({ id: 'rec_1' })
    })

    it('rejects an invalid body before writing', async () => {
      // required `title` omitted → readValidatedBody throws → no write happens
      await expect(postHandler({ __body: INVALID_BODY } as any)).rejects.toBeTruthy()
      expect(createMainSnippet).not.toHaveBeenCalled()
    })
  })

  describe('[snippetId].patch', () => {
    it('400s when the id param is missing', async () => {
      await expect(patchHandler({ __params: {}, __body: {} } as any)).rejects.toMatchObject({ status: 400 })
    })

    it('rejects an unauthenticated request and never writes', async () => {
      unauth()
      await expect(patchHandler({ __params: { snippetId: 'rec_1' }, __body: {} } as any)).rejects.toBeTruthy()
      expect(updateMainSnippet).not.toHaveBeenCalled()
    })

    it('updates scoped to the resolved team', async () => {
      ;(updateMainSnippet as any).mockResolvedValue({ id: 'rec_1' })
      await patchHandler({ __params: { snippetId: 'rec_1' }, __body: {} } as any)
      expect(updateMainSnippet).toHaveBeenCalledWith('rec_1', TEAM.id, USER.id, expect.anything(), expect.anything())
    })

    it('propagates a not-found from the query as a 404', async () => {
      ;(updateMainSnippet as any).mockRejectedValue(Object.assign(new Error('not found'), { status: 404 }))
      await expect(patchHandler({ __params: { snippetId: 'missing' }, __body: {} } as any)).rejects.toMatchObject({ status: 404 })
    })
  })

  describe('[snippetId].delete', () => {
    it('400s when the id param is missing', async () => {
      await expect(deleteHandler({ __params: {} } as any)).rejects.toMatchObject({ status: 400 })
    })

    it('rejects an unauthenticated request and never writes', async () => {
      unauth()
      await expect(deleteHandler({ __params: { snippetId: 'rec_1' } } as any)).rejects.toBeTruthy()
      expect(deleteMainSnippet).not.toHaveBeenCalled()
    })

    it('deletes scoped to the resolved team', async () => {
      ;(deleteMainSnippet as any).mockResolvedValue({ success: true })
      await deleteHandler({ __params: { snippetId: 'rec_1' } } as any)
      expect(deleteMainSnippet).toHaveBeenCalledWith('rec_1', TEAM.id, USER.id, expect.anything())
    })

    it('propagates a not-found from the query as a 404', async () => {
      ;(deleteMainSnippet as any).mockRejectedValue(Object.assign(new Error('not found'), { status: 404 }))
      await expect(deleteHandler({ __params: { snippetId: 'missing' } } as any)).rejects.toMatchObject({ status: 404 })
    })
  })
})
