/**
 * #3136 — a logged-out caller must not widen visibility with `?visibility=admin`.
 * Drives the real handler with mocked drizzle operators, auth and DB.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const state = vi.hoisted(() => ({ query: {} as Record<string, string>, selects: 0, conds: [] as any[] }))

vi.hoisted(() => {
  const g = globalThis as any
  g.defineEventHandler = (fn: any) => fn
  g.getRouterParam = () => 't'
  g.getQuery = () => (globalThis as any).__q ?? {}
  g.createError = (err: any) => Object.assign(new Error(err?.statusText || 'error'), err)
  g.useDB = () => (globalThis as any).__db
})

vi.mock('drizzle-orm', () => ({
  eq: (_a: any, b: any) => ({ op: 'eq', b }),
  or: (...a: any[]) => ({ op: 'or', a }),
  and: (...a: any[]) => { state.conds = a; return { op: 'and', a } },
  asc: (a: any) => a,
  inArray: (_a: any, b: any) => ({ op: 'in', b })
}))
vi.mock('@fyit/crouton-auth/server/utils/useServerAuth', () => ({ getServerSession: async () => null }))
vi.mock('@fyit/crouton-auth/server/utils/scoped-access', () => ({ validateScopedTokenFromEvent: async () => null }))
vi.mock('@fyit/crouton-auth/server/database/schema/auth', () => ({
  organization: { id: 'id', slug: 'slug' },
  member: { id: 'id', role: 'role', userId: 'userId', organizationId: 'organizationId' }
}))

import handler from '../server/api/teams/[id]/pages.get'

function makeDb() {
  return {
    select: () => {
      state.selects++
      const chain: any = {
        from: () => chain,
        where: () => chain,
        limit: () => chain,
        orderBy: async () => [],
        then: (res: any) => Promise.resolve([{ id: 't' }]).then(res)
      }
      return chain
    }
  }
}

describe('GET pages visibility (#3136)', () => {
  beforeEach(() => {
    state.selects = 0
    state.conds = []
  })

  it('logged-out ?visibility=admin returns nothing and never queries pages', async () => {
    ;(globalThis as any).__q = { visibility: 'admin' }
    ;(globalThis as any).__db = makeDb()
    const res: any = await (handler as any)({})
    expect(res.data).toEqual([])
    // only the team lookup ran, no pages select
    expect(state.selects).toBe(1)
  })

  it('logged-out without param filters to public only', async () => {
    ;(globalThis as any).__q = {}
    ;(globalThis as any).__db = makeDb()
    await (handler as any)({})
    const vis = state.conds.find((c: any) => c.op === 'in')
    expect(vis.b).toEqual(['public'])
  })
})
