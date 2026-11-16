import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const hoisted = vi.hoisted(() => ({
  member: { team: { id: 't1' }, user: { id: 'u1' }, membership: { role: 'admin' } },
  create: vi.fn(async (d: any) => d)
}))

vi.mock('@fyit/crouton-auth/server/utils/team', () => ({
  resolveTeamAndCheckMembership: async () => hoisted.member,
  requireTeamAdmin: async () => hoisted.member
}))
vi.mock('../collections/products/server/database/queries', () => ({ createCatalogProduct: hoisted.create, updateCatalogProduct: vi.fn(), getCatalogProductsByIds: vi.fn() }))

let body: unknown

beforeEach(() => {
  hoisted.create.mockClear()
  vi.stubGlobal('defineEventHandler', (fn: any) => fn)
  vi.stubGlobal('readValidatedBody', async (_e: any, parse: (b: unknown) => unknown) => parse(body))
})
afterEach(() => vi.unstubAllGlobals())

const run = async () => (await import('../collections/products/server/api/teams/[id]/catalog-products/index.post')).default({})

describe('catalog products body validation (#3377)', () => {
  it('rejects a body without a title before the query runs', async () => {
    body = { description: 'no title', active: true }
    await expect(run()).rejects.toThrow()
    expect(hoisted.create).not.toHaveBeenCalled()
  })

  it('overwrites a client-supplied teamId with the route team', async () => {
    body = { title: 'A', teamId: 'other' }
    await run()
    const arg = hoisted.create.mock.calls[0]![0]
    expect(arg.teamId).toBe('t1')
    expect(arg.owner).toBe('u1')
    expect(arg.title).toBe('A')
  })
})
