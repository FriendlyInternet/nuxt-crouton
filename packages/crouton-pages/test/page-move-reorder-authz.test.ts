/**
 * #3136 — non-admin members may only move/reorder pages they own; a rejected
 * request must not write anything.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => {
  const g = globalThis as any
  g.defineEventHandler = (fn: any) => fn
  g.useServerTiming = () => ({ start: () => ({ end: () => {} }) })
  g.getRouterParams = (event: any) => event?.__params ?? {}
  g.readBody = async (event: any) => event?.__body
  g.createError = (err: any) => Object.assign(new Error(err?.statusText || 'error'), err)
  return { rows: [] as any[], updates: vi.fn(), role: 'member' }
})

vi.mock('drizzle-orm', () => ({
  eq: (a: any, b: any) => ({ op: 'eq', a, b }),
  and: (...a: any[]) => ({ op: 'and', a }),
  inArray: (a: any, b: any) => ({ op: 'in', a, b }),
  desc: (a: any) => a,
  asc: (a: any) => a,
  sql: (() => ({})) as any
}))
vi.mock('drizzle-orm/sqlite-core', () => ({ alias: (t: any) => t }))
vi.mock('../collections/pages/server/database/schema', () => ({
  pagesPages: { id: 'id', teamId: 'teamId', owner: 'owner', path: 'path', order: 'order' }
}))
vi.mock('@fyit/crouton-auth/server/utils/team', () => ({
  resolveTeamAndCheckMembership: async () => ({
    team: { id: 'team_1' }, user: { id: 'u1' }, membership: { role: h.role }
  })
}))

import moveHandler from '../collections/pages/server/api/teams/[id]/pages-pages/[pageId]/move.patch'
import reorderHandler from '../collections/pages/server/api/teams/[id]/pages-pages/reorder.patch'

function installDb() {
  ;(globalThis as any).useDB = () => ({
    select: () => {
      const chain: any = {
        from: () => chain,
        where: () => chain,
        orderBy: () => chain,
        then: (res: any) => Promise.resolve(h.rows).then(res)
      }
      return chain
    },
    update: () => {
      const chain: any = {
        set: (v: any) => { h.updates(v); return chain },
        where: () => chain,
        returning: async () => [{ id: 'x' }]
      }
      return chain
    }
  })
}

const move = (pageId: string) =>
  (moveHandler as any)({ __params: { pageId }, __body: { order: 1, parentId: null } })
const reorder = (ids: string[]) =>
  (reorderHandler as any)({ __body: { updates: ids.map((id, i) => ({ id, order: i })) } })

describe('page move/reorder authorization (#3136)', () => {
  beforeEach(() => {
    h.updates.mockClear()
    h.role = 'member'
    h.rows = []
    installDb()
  })

  it('member moving another member\'s page → 403, nothing written', async () => {
    h.rows = [{ id: 'p1', owner: 'other', path: '/p1/', depth: 0 }]
    await expect(move('p1')).rejects.toMatchObject({ status: 403 })
    expect(h.updates).not.toHaveBeenCalled()
  })

  it('member moving own page → ok', async () => {
    h.rows = [{ id: 'p1', owner: 'u1', path: '/p1/', depth: 0 }]
    await expect(move('p1')).resolves.toBeDefined()
    expect(h.updates).toHaveBeenCalled()
  })

  it('admin moving anyone\'s page → ok', async () => {
    h.role = 'admin'
    h.rows = [{ id: 'p1', owner: 'other', path: '/p1/', depth: 0 }]
    await expect(move('p1')).resolves.toBeDefined()
  })

  it('missing page → 404', async () => {
    h.rows = []
    await expect(move('nope')).rejects.toMatchObject({ status: 404 })
  })

  it('member reordering a mix of own and others\' pages → 403 with no partial write', async () => {
    h.rows = [{ id: 'a', owner: 'u1' }, { id: 'b', owner: 'other' }]
    await expect(reorder(['a', 'b'])).rejects.toMatchObject({ status: 403 })
    expect(h.updates).not.toHaveBeenCalled()
  })

  it('member reordering missing ids → 404, nothing written', async () => {
    h.rows = [{ id: 'a', owner: 'u1' }]
    await expect(reorder(['a', 'b'])).rejects.toMatchObject({ status: 404 })
    expect(h.updates).not.toHaveBeenCalled()
  })

  it('member reordering own pages → ok', async () => {
    h.rows = [{ id: 'a', owner: 'u1' }, { id: 'b', owner: 'u1' }]
    await expect(reorder(['a', 'b'])).resolves.toHaveLength(2)
  })

  it('admin reordering anyone\'s pages → ok', async () => {
    h.role = 'admin'
    h.rows = [{ id: 'a', owner: 'other' }]
    await expect(reorder(['a'])).resolves.toHaveLength(1)
  })
})
