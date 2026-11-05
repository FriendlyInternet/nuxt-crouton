/**
 * #3380 — a `list: 'own'` collection is never readable through the public endpoints.
 * Drives both real handlers with mocked drizzle, schema and DB.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.hoisted(() => {
  const g = globalThis as any
  g.defineCachedEventHandler = (fn: any) => fn
  g.getRouterParam = (_e: any, k: string) => ({ team: 't', collection: 'shopNotes', itemId: 'n2' } as any)[k]
  g.getQuery = () => ({})
  g.createError = (err: any) => Object.assign(new Error(err?.statusText || 'error'), err, { statusCode: err?.status })
  g.useDB = () => (globalThis as any).__db
})

vi.mock('drizzle-orm', () => ({
  eq: () => ({}),
  or: () => ({}),
  and: () => ({}),
}))
vi.mock('@fyit/crouton-auth/server/database/schema/auth', () => ({
  organization: { id: 'id', slug: 'slug' },
}))
vi.mock('../collections/pages/server/database/schema', () => ({
  pagesPages: { teamId: 1, pageType: 2, status: 3, visibility: 4 },
}))

import listHandler from '../server/api/public/[team]/[collection].get'
import itemHandler from '../server/api/public/[team]/[collection]/[itemId].get'

const rows = [
  { id: 'n1', body: 'alice private' },
  { id: 'n2', body: 'bob private' },
]

function makeDb() {
  let call = 0
  return {
    select: () => {
      const n = call++
      const result = n === 0
        ? [{ id: 't', slug: 't' }]
        : [{ config: JSON.stringify({ collection: 'shopNotes' }) }]
      const chain: any = {
        from: () => chain,
        where: () => (n === 0 ? chain : Promise.resolve(result)),
        limit: () => chain,
        then: (res: any) => Promise.resolve(result).then(res),
      }
      return chain
    },
  }
}

const getAll = vi.fn(async () => async () => rows)
const getByIds = vi.fn(async () => async (_t: string, ids: string[]) => rows.filter(r => ids.includes(r.id)))

function register(access?: () => Promise<any>) {
  ;(globalThis as any).__crouton_query_registry = {
    shopNotes: { getAll, getByIds, ...(access ? { access } : {}) },
  }
}

beforeEach(() => {
  getAll.mockClear()
  getByIds.mockClear()
  ;(globalThis as any).__db = makeDb()
})

describe('public endpoints vs collection access (#3380)', () => {
  it('list: own → list handler refuses with 404 and never queries', async () => {
    register(async () => ({ list: 'own' }))
    await expect((listHandler as any)({})).rejects.toMatchObject({ statusCode: 404 })
    expect(getAll).not.toHaveBeenCalled()
  })

  it('list: own → item handler refuses with 404 and never queries', async () => {
    register(async () => ({ list: 'own' }))
    await expect((itemHandler as any)({})).rejects.toMatchObject({ statusCode: 404 })
    expect(getByIds).not.toHaveBeenCalled()
  })

  it('list: team → rows are returned', async () => {
    register(async () => ({ list: 'team' }))
    const list: any = await (listHandler as any)({})
    expect(list.data).toHaveLength(2)
    ;(globalThis as any).__db = makeDb()
    const item: any = await (itemHandler as any)({})
    expect(item.data.id).toBe('n2')
  })

  it('real regenerated fixtures/minimal membernotes (list: own) → both endpoints 404', async () => {
    const q: any = await import('../../../fixtures/minimal/layers/main/collections/membernotes/server/database/queries')
    expect(q.MainMembernotesAccess).toMatchObject({ list: 'own' })
    register(async () => q.MainMembernotesAccess)
    await expect((listHandler as any)({})).rejects.toMatchObject({ statusCode: 404 })
    ;(globalThis as any).__db = makeDb()
    await expect((itemHandler as any)({})).rejects.toMatchObject({ statusCode: 404 })
    expect(getAll).not.toHaveBeenCalled()
    expect(getByIds).not.toHaveBeenCalled()
  })

  it('no access loader (legacy registry) → behaviour unchanged', async () => {
    register()
    const list: any = await (listHandler as any)({})
    expect(list.data).toHaveLength(2)
  })
})
