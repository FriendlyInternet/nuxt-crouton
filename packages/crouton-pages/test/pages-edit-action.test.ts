/**
 * #4108 — the page APIs follow the `pages:edit` action, not a role name.
 *
 * A site that grants `pages:edit` to `member` lets that member create, update and
 * delete ANOTHER member's page (the update/delete queries drop the owner
 * condition: `seesAll: true`) and use the page access-code route. Without the
 * grant (the no-config default) the same member stays limited to their own pages
 * and is refused the access code.
 *
 * The real route handlers and the real update/delete queries run; drizzle is a
 * recorder (as in page-move-reorder-authz.test.ts) so the test can read the
 * WHERE the query built. `can()` / `requireCan()` are the test stand-ins fed the
 * site's role map — the real ones are proven in crouton-auth's tests.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => {
  const g = globalThis as any
  g.defineEventHandler = (fn: any) => fn
  g.useServerTiming = () => ({ start: () => ({ end: () => {} }) })
  g.getRouterParams = (event: any) => event?.__params ?? {}
  g.getRouterParam = (event: any, name: string) => event?.__params?.[name]
  g.readBody = async (event: any) => event?.__body
  g.readValidatedBody = async (event: any, validate: any) => validate(event?.__body)
  g.useRuntimeConfig = () => ({})
  g.createError = (err: any) => Object.assign(new Error(err?.statusText || 'error'), err)
  return {
    grants: {} as Record<string, '*' | string[]>,
    where: [] as any[],
    create: vi.fn(async (d: any) => d),
    upsert: vi.fn(async () => {})
  }
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
vi.mock('../collections/pages/server/database/queries', async (orig) => ({
  ...(await orig() as object),
  createPagesPage: h.create
}))
vi.mock('@fyit/crouton-auth/server/utils/scoped-access', () => ({
  upsertScopedGrant: h.upsert,
  revokeScopedGrantsForResource: async () => {},
  listScopedGrantsForResource: async () => []
}))

const MEMBER = { team: { id: 'team_1' }, user: { id: 'u_member' }, membership: { role: 'member' } }
vi.mock('@fyit/crouton-auth/server/utils/team', () => ({ resolveTeamAndCheckMembership: async () => MEMBER }))
vi.mock('@fyit/crouton-auth/server/utils/team-auth', async () => {
  const { teamAuthStub, DEFAULT_GRANTS } = await import('./stubs/team-auth')
  return teamAuthStub(() => MEMBER, () => ({ ...DEFAULT_GRANTS, ...h.grants })).module
})

import postHandler from '../collections/pages/server/api/teams/[id]/pages-pages/index.post'
import patchHandler from '../collections/pages/server/api/teams/[id]/pages-pages/[pageId].patch'
import deleteHandler from '../collections/pages/server/api/teams/[id]/pages-pages/[pageId].delete'
import accessCodeHandler from '../server/api/teams/[id]/pages/[pageId]/access-code'

/** A db whose update/delete record their WHERE and match one row; select finds the page. */
function installDb() {
  ;(globalThis as any).useDB = () => {
    const writer = () => {
      const chain: any = {
        set: () => chain,
        where: (w: any) => { h.where.push(w); return chain },
        returning: async () => [{ id: 'p_other' }]
      }
      return chain
    }
    const reader: any = { from: () => reader, where: () => reader, limit: async () => [{ id: 'p_other' }] }
    return { update: writer, delete: writer, select: () => reader }
  }
}

/** Does a recorded WHERE restrict the write to the caller's own rows? */
const ownerScoped = (where: any) => where.a.some((c: any) => c.op === 'eq' && c.a === 'owner')

const page = { __params: { pageId: 'p_other' } }
const validPage = { pageType: 'regular', status: 'draft', visibility: 'public', translations: { en: { title: 'T', slug: 't' } } }

beforeEach(() => {
  h.grants = {}
  h.where = []
  h.create.mockClear()
  h.upsert.mockClear()
  installDb()
})

describe('pages:edit granted to member (#4108)', () => {
  beforeEach(() => { h.grants = { member: ['pages:edit'] } })

  it('member creates a page', async () => {
    await postHandler({ __body: validPage } as any)
    expect(h.create).toHaveBeenCalledWith(expect.objectContaining({ teamId: 'team_1', owner: 'u_member' }))
  })

  it("member updates another member's page (query gets seesAll: true)", async () => {
    await expect(patchHandler({ ...page, __body: { status: 'published' } } as any)).resolves.toMatchObject({ id: 'p_other' })
    expect(h.where).toHaveLength(1)
    expect(ownerScoped(h.where[0])).toBe(false)
  })

  it("member deletes another member's page (query gets seesAll: true)", async () => {
    await expect(deleteHandler(page as any)).resolves.toEqual({ success: true })
    expect(ownerScoped(h.where[0])).toBe(false)
  })

  it('member sets the page access code', async () => {
    await expect(accessCodeHandler({ ...page, method: 'PUT', __body: { code: '1234' } } as any)).resolves.toEqual({ exists: true })
    expect(h.upsert).toHaveBeenCalledWith(expect.objectContaining({ organizationId: 'team_1', resourceId: 'p_other' }))
  })
})

describe('no site config: member has no pages:edit (#4108)', () => {
  it('update and delete stay scoped to the member\'s own pages', async () => {
    await patchHandler({ ...page, __body: { status: 'published' } } as any)
    await deleteHandler(page as any)
    expect(h.where.map(ownerScoped)).toEqual([true, true])
  })

  it('access code is refused (403), nothing written', async () => {
    await expect(accessCodeHandler({ ...page, method: 'PUT', __body: { code: '1234' } } as any)).rejects.toMatchObject({ status: 403 })
    expect(h.upsert).not.toHaveBeenCalled()
  })
})
