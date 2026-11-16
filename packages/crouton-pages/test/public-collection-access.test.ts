/**
 * #3380 — public collection endpoints must refuse a `list: 'own'` collection
 * ("members only see their own rows") before running any query.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.hoisted(() => {
  const g = globalThis as any
  g.defineCachedEventHandler = (fn: any) => fn
  g.getRouterParam = (_e: any, name: string) => ({ team: 't', collection: 'shopNotes', itemId: 'n2' } as any)[name]
  g.getQuery = () => ({})
  g.createError = (err: any) => Object.assign(new Error(err?.statusText || 'error'), err, { statusCode: err?.status })
  g.useDB = () => (globalThis as any).__db
})

vi.mock('drizzle-orm', () => ({
  eq: (_a: any, b: any) => ({ op: 'eq', b }),
  or: (...a: any[]) => ({ op: 'or', a }),
  and: (...a: any[]) => ({ op: 'and', a })
}))
vi.mock('@fyit/crouton-auth/server/database/schema/auth', () => ({
  organization: { id: 'id', slug: 'slug' }
}))
vi.mock('../collections/pages/server/database/schema', () => ({
  pagesPages: { teamId: 'teamId', pageType: 'pageType', status: 'status', visibility: 'visibility' }
}))

import listHandler from '../server/api/public/[team]/[collection].get'
import itemHandler from '../server/api/public/[team]/[collection]/[itemId].get'

const rows = [
  { id: 'n1', body: 'alice private' },
  { id: 'n2', body: 'bob private' }
]

function makeDb() {
  let call = 0
  return {
    select: () => {
      const result = call++ === 0
        ? [{ id: 't', slug: 't' }]
        : [{ config: JSON.stringify({ collection: 'shopNotes' }) }]
      const chain: any = {
        from: () => chain,
        where: () => chain,
        limit: () => chain,
        then: (res: any) => Promise.resolve(result).then(res)
      }
      return chain
    }
  }
}

function register(access?: () => Promise<any>) {
  const getAll = vi.fn(async () => rows)
  const getByIds = vi.fn(async (_t: string, ids: string[]) => rows.filter(r => ids.includes(r.id)))
  ;(globalThis as any).__crouton_query_registry = {
    shopNotes: {
      getAll: async () => getAll,
      getByIds: async () => getByIds,
      ...(access ? { access } : {})
    }
  }
  ;(globalThis as any).__db = makeDb()
  return { getAll, getByIds }
}

describe('public collection endpoints vs access.list (#3380)', () => {
  beforeEach(() => {
    delete (globalThis as any).__crouton_query_registry
  })

  it("list: 'own' → list endpoint 404s and never queries", async () => {
    const { getAll } = register(async () => ({ list: 'own' }))
    await expect((listHandler as any)({})).rejects.toMatchObject({ status: 404 })
    expect(getAll).not.toHaveBeenCalled()
  })

  it("list: 'own' → item endpoint 404s and never queries", async () => {
    const { getByIds } = register(async () => ({ list: 'own' }))
    await expect((itemHandler as any)({})).rejects.toMatchObject({ status: 404 })
    expect(getByIds).not.toHaveBeenCalled()
  })

  it("list: 'team' → both endpoints return rows", async () => {
    register(async () => ({ list: 'team' }))
    const list: any = await (listHandler as any)({})
    expect(list.data).toHaveLength(2)
    ;(globalThis as any).__db = makeDb()
    const item: any = await (itemHandler as any)({})
    expect(item.data.id).toBe('n2')
  })

  it('no access loader (legacy registry) → behaviour unchanged', async () => {
    register()
    const list: any = await (listHandler as any)({})
    expect(list.data).toHaveLength(2)
  })
})
