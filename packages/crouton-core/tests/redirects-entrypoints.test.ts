import { describe, it, expect, vi, beforeEach } from 'vitest'

// Teams: slug -> id (mutable so a test can rename a slug)
const slugs: Record<string, string> = { a: 'A', b: 'B' }
const domains = { current: undefined as string | undefined }

vi.mock('../server/database/queries/redirects', () => ({
  getActiveCroutonRedirects: vi.fn(async () => [
    { teamId: 'A', fromPath: '/old', toPath: '/new', statusCode: '301' },
    { teamId: 'A', fromPath: '/a/legacy', toPath: '/a/legacy-new', statusCode: '301' },
    { teamId: 'A', fromPath: '/dup', toPath: '/a/dup2', statusCode: '301' },
    { teamId: 'B', fromPath: '/b/legacy', toPath: '/x', statusCode: '301' },
    { teamId: 'B', fromPath: '/led002', toPath: '/b-new', statusCode: '302' }
  ]),
  createCroutonRedirect: vi.fn(async (v: any) => v),
  updateCroutonRedirect: vi.fn(async () => ({ ok: true })),
  deleteCroutonRedirect: vi.fn(async () => ({ ok: true }))
}))

vi.mock('@fyit/crouton-auth/server/utils/team', () => ({
  getTeamBySlug: vi.fn(async (_e: any, slug: string) => (slugs[slug] ? { id: slugs[slug] } : null)),
  requireTeamAdmin: vi.fn(async (event: any) => {
    const role = event.role
    if (role !== 'admin' && role !== 'owner') {
      throw Object.assign(new Error('Forbidden'), { status: 403 })
    }
    return { team: { id: 'A' }, user: { id: 'u1' }, membership: { role } }
  })
}))

import { invalidateRedirectCache } from '../server/utils/redirectCache'

const g = globalThis as any
g.defineEventHandler = (fn: any) => fn
g.getRequestPath = (e: any) => e.path
g.useRuntimeConfig = () => ({ public: {} })
g.sendRedirect = (_e: any, to: string, code: number) => ({ redirected: to, code })
g.createError = (e: any) => Object.assign(new Error(e.statusText), e)
g.useServerTiming = () => ({ start: () => ({ end: () => {} }) })
g.getRouterParams = (e: any) => ({ redirectId: 'r1', ...(e.params || {}) })
g.readBody = async (e: any) => e.body

const mw = async (path: string, ctx: Record<string, any> = {}) => {
  const handler = (await import('../server/middleware/redirects')).default as any
  return handler({ path, context: ctx })
}

beforeEach(() => {
  invalidateRedirectCache()
  slugs.a = 'A'
  delete slugs.a2
  domains.current = undefined
})

describe('redirect middleware (real handler)', () => {
  it('4) custom-domain request redirects within that domain\'s team', async () => {
    expect(await mw('/old', { resolvedDomainTeamId: 'A' })).toEqual({ redirected: '/new', code: 301 })
    // same path on another team's domain does not fire
    expect(await mw('/old', { resolvedDomainTeamId: 'B' })).toBeUndefined()
  })

  it('5) after team A renames a -> a2, /a2/old still redirects', async () => {
    expect(await mw('/a/old')).toEqual({ redirected: '/a/new', code: 301 })
    delete slugs.a
    slugs.a2 = 'A'
    expect(await mw('/a2/old')).toEqual({ redirected: '/a2/new', code: 301 })
    expect(await mw('/a/old')).toBeUndefined()
  })

  it('6) another team\'s /led002 does not fire for this team', async () => {
    expect(await mw('/a/led002')).toBeUndefined()
    expect(await mw('/b/led002')).toEqual({ redirected: '/b/b-new', code: 302 })
  })
})

describe('redirect review findings', () => {
  it('1) custom domain: team from host, not first path segment', async () => {
    expect(await mw('/old', { resolvedDomainTeamId: 'A' })).toEqual({ redirected: '/new', code: 301 })
    expect(await mw('/b/led002', { resolvedDomainTeamId: 'A' })).toBeUndefined()
  })
  it('2) legacy row stored with the team prefix still works, same team only', async () => {
    expect(await mw('/a/legacy')).toEqual({ redirected: '/a/legacy-new', code: 301 })
    expect(await mw('/b/legacy')).toEqual({ redirected: '/b/x', code: 301 })
    expect(await mw('/a/b/legacy')).toBeUndefined()
  })
  it('3) Location keeps team prefix by mode', async () => {
    expect(await mw('/a/old?x=1')).toEqual({ redirected: '/a/new?x=1', code: 301 })
    expect(await mw('/a/dup')).toEqual({ redirected: '/a/dup2', code: 301 })
    expect(await mw('/old', { resolvedDomainTeamId: 'A' })).toEqual({ redirected: '/new', code: 301 })
  })
})

describe('redirect endpoints (real handlers)', () => {
  const base = { body: { fromPath: '/x', toPath: '/y' } }
  const load = async () => ({
    post: (await import('../server/api/teams/[id]/crouton-redirects/index.post')).default as any,
    patch: (await import('../server/api/teams/[id]/crouton-redirects/[redirectId].patch')).default as any,
    del: (await import('../server/api/teams/[id]/crouton-redirects/[redirectId].delete')).default as any
  })

  it('7) member gets 403 on POST/PATCH/DELETE', async () => {
    const { post, patch, del } = await load()
    for (const h of [post, patch, del]) {
      await expect(h({ ...base, role: 'member' })).rejects.toMatchObject({ status: 403 })
    }
  })

  it('7) team admin succeeds on POST/PATCH/DELETE', async () => {
    const { post, patch, del } = await load()
    for (const h of [post, patch, del]) {
      await expect(h({ ...base, role: 'admin' })).resolves.toBeDefined()
    }
  })
})
