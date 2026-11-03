/**
 * #2309 — a package registers its own collections' queries at runtime.
 *
 * The app's generated `server/utils/crouton-query-registry.ts` only lists collections the app
 * generated. Since #2278 the sales, bookings, pages and assets collections ship from their
 * packages, so a public collection-binder page bound to one of them answered "not found".
 * Each package now merges its entries into one process-wide registry; the pages endpoints read
 * the union, with the app's own registry winning on a clash.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import {
  QUERY_REGISTRY_KEY,
  registerCollectionQueries,
  resolveQueryRegistry,
  collectionQueries,
} from '../shared/utils/query-registry'

const entry = (tag: string) => ({
  getAll: async () => async () => [tag],
  getByIds: async () => async () => [tag],
})

beforeEach(() => {
  delete (globalThis as any)[QUERY_REGISTRY_KEY]
})

describe('registerCollectionQueries', () => {
  it('creates the process-wide registry on first use and merges later packages into it', () => {
    registerCollectionQueries({ salesProducts: entry('sales') })
    registerCollectionQueries({ croutonAssets: entry('assets') })
    const global = (globalThis as any)[QUERY_REGISTRY_KEY]
    expect(Object.keys(global).sort()).toEqual(['croutonAssets', 'salesProducts'])
  })
})

describe('resolveQueryRegistry', () => {
  it('is empty when nothing is registered and the app has no registry', () => {
    expect(resolveQueryRegistry(undefined)).toEqual({})
    expect(resolveQueryRegistry(null)).toEqual({})
  })

  it('exposes package entries to an app that generated no registry', () => {
    registerCollectionQueries({ salesProducts: entry('sales') })
    expect(Object.keys(resolveQueryRegistry(undefined))).toEqual(['salesProducts'])
  })

  it('unions package entries with the app registry, and the app wins on a clash', async () => {
    registerCollectionQueries({ salesProducts: entry('package'), croutonAssets: entry('assets') })
    const resolved = resolveQueryRegistry({ salesProducts: entry('app'), mainItems: entry('app') })
    expect(Object.keys(resolved).sort()).toEqual(['croutonAssets', 'mainItems', 'salesProducts'])
    const getAll = await resolved.salesProducts.getAll()
    expect(await getAll('team')).toEqual(['app'])
  })
})

describe('collectionQueries', () => {
  it('resolves getAll<Name> and get<Name>ByIds from a lazily loaded queries module', async () => {
    const load = async () => ({
      getAllSalesProducts: async (teamId: string) => [`all:${teamId}`],
      getSalesProductsByIds: async (teamId: string, ids: string[]) => [`ids:${teamId}:${ids.join('+')}`],
    })
    const q = collectionQueries(load, 'SalesProducts')
    expect(await (await q.getAll())('t1')).toEqual(['all:t1'])
    expect(await (await q.getByIds())('t1', ['a', 'b'])).toEqual(['ids:t1:a+b'])
  })
})
