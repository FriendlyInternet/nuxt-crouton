import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../server/database/queries/redirects', () => ({
  getActiveCroutonRedirects: vi.fn(async () => [
    { teamId: 'A', fromPath: '/old', toPath: '/new', statusCode: '301' },
    { teamId: 'A', fromPath: '/', toPath: 'https://evil.example', statusCode: '302' },
    { teamId: 'A', fromPath: '/x', toPath: '//evil.example', statusCode: '302' }
  ])
}))

import { isSafeRedirectPath, validateRedirectInput } from '../server/utils/redirectValidation'
import { findRedirect, getRedirectMap, invalidateRedirectCache } from '../server/utils/redirectCache'

describe('isSafeRedirectPath', () => {
  it('accepts same-site paths', () => {
    expect(isSafeRedirectPath('/new')).toBe(true)
    expect(isSafeRedirectPath('/a?x=1')).toBe(true)
  })
  it('rejects off-site / malformed targets', () => {
    for (const v of ['https://x', '//evil', '/\\evil', 'javascript:alert(1)', '', '/a\nb', undefined]) {
      expect(isSafeRedirectPath(v)).toBe(false)
    }
  })
})

describe('validateRedirectInput', () => {
  beforeEach(() => {
    ;(globalThis as any).createError = (e: any) => Object.assign(new Error(e.statusText), e)
  })
  it('accepts allowed status codes', () => {
    expect(validateRedirectInput({ fromPath: '/a', toPath: '/b', statusCode: 308 }).statusCode).toBe('308')
  })
  it('rejects bad status codes and off-site targets', () => {
    for (const statusCode of ['200', '303', 'abc']) {
      expect(() => validateRedirectInput({ fromPath: '/a', toPath: '/b', statusCode })).toThrow()
    }
    expect(() => validateRedirectInput({ fromPath: '/', toPath: 'https://evil.example' })).toThrow()
  })
  it('partial allows omitted fields but still checks provided ones', () => {
    expect(validateRedirectInput({ isActive: false }, true)).toEqual({ isActive: false })
    expect(() => validateRedirectInput({ toPath: '//evil' }, true)).toThrow()
  })
})

describe('team-scoped redirect lookup', () => {
  beforeEach(() => invalidateRedirectCache())
  it('matches only for the owning team', async () => {
    const map = await getRedirectMap()
    expect(findRedirect(map, 'A', '/old')?.toPath).toBe('/new')
    expect(findRedirect(map, 'B', '/old')).toBeUndefined()
    expect(findRedirect(map, null, '/old')).toBeUndefined()
  })
  it('drops stored off-site targets', async () => {
    const map = await getRedirectMap()
    expect(findRedirect(map, 'A', '/')).toBeUndefined()
    expect(findRedirect(map, 'A', '/x')).toBeUndefined()
  })
})

describe('redirects middleware', () => {
  const getTeamBySlug = vi.fn()
  const sendRedirect = vi.fn((_e: any, to: string, code: number) => ({ to, code }))

  async function run(path: string, team: { id: string } | null | ((slug: string) => { id: string } | null) = null, ctx: Record<string, any> = {}, defaultTeamSlug?: string) {
    vi.resetModules()
    getTeamBySlug.mockReset()
    getTeamBySlug.mockImplementation(async (_e: any, slug: string) => (typeof team === 'function' ? team(slug) : team))
    sendRedirect.mockClear()
    ;(globalThis as any).defineEventHandler = (fn: any) => fn
    ;(globalThis as any).getRequestPath = () => path
    ;(globalThis as any).sendRedirect = sendRedirect
    ;(globalThis as any).useRuntimeConfig = () => ({ public: { crouton: { auth: { teams: { defaultTeamSlug } } } } })
    vi.doMock('@fyit/crouton-auth/server/utils/team', () => ({ getTeamBySlug }))
    const mod = await import('../server/middleware/redirects')
    return (mod.default as any)({ context: ctx })
  }

  it('nothing resolvable (unknown slug, no custom domain) => no redirect', async () => {
    await run('/unknown/old')
    expect(sendRedirect).not.toHaveBeenCalled()
  })

  it('redirects for the slug team', async () => {
    await run('/acme/old?x=1', { id: 'A' })
    expect(sendRedirect).toHaveBeenCalledWith(expect.anything(), '/acme/new?x=1', 301)
  })

  it('empty map => getTeamBySlug never called', async () => {
    const q = await import('../server/database/queries/redirects')
    vi.mocked(q.getActiveCroutonRedirects).mockResolvedValueOnce([])
    await run('/acme/old', { id: 'A' })
    expect(getTeamBySlug).not.toHaveBeenCalled()
    expect(sendRedirect).not.toHaveBeenCalled()
  })

  it('slug renamed and taken by another team => old team redirects do not fire', async () => {
    await run('/acme/old', { id: 'B' })
    expect(sendRedirect).not.toHaveBeenCalled()
  })

  it('slug is looked up on every request (no cache)', async () => {
    await run('/acme/old', { id: 'A' })
    getTeamBySlug.mockResolvedValue({ id: 'B' })
    const mod: any = await import('../server/middleware/redirects')
    sendRedirect.mockClear()
    await mod.default({ context: {} })
    expect(getTeamBySlug).toHaveBeenCalledTimes(2)
    expect(sendRedirect).not.toHaveBeenCalled()
  })

  it('single-team app path without a slug => redirects via the default team', async () => {
    await run('/old', slug => (slug === 'led002' ? { id: 'A' } : null), {}, 'led002')
    expect(getTeamBySlug).toHaveBeenCalledWith(expect.anything(), 'led002')
    expect(sendRedirect).toHaveBeenCalledWith(expect.anything(), '/new', 301)
  })
  const withRows = (rows: any[]) => vi.doMock('../server/database/queries/redirects', () => ({ getActiveCroutonRedirects: vi.fn(async () => rows) }))

  it('default-team setting set: another team\'s /led002 and /archief rows do not fire for a default-team path', async () => {
    withRows([
      { teamId: 'B', fromPath: '/led002', toPath: '/b-led', statusCode: '301' },
      { teamId: 'B', fromPath: '/archief', toPath: '/b-archief', statusCode: '301' }
    ])
    await run('/led002', slug => (slug === 'led002' ? { id: 'A' } : null), {}, 'led002')
    expect(sendRedirect).not.toHaveBeenCalled()
    await run('/archief', slug => (slug === 'led002' ? { id: 'A' } : null), {}, 'led002')
    expect(sendRedirect).not.toHaveBeenCalled()
  })

  it('team A renames slug and team B takes the old one: A\'s redirects do not fire for B, B\'s own do', async () => {
    withRows([
      { teamId: 'A', fromPath: '/old', toPath: '/new', statusCode: '301' },
      { teamId: 'B', fromPath: '/b-old', toPath: '/b-new', statusCode: '301' }
    ])
    // slug "acme" now belongs to B
    await run('/acme/old', slug => (slug === 'acme' ? { id: 'B' } : null))
    expect(sendRedirect).not.toHaveBeenCalled()
    await run('/acme/b-old', slug => (slug === 'acme' ? { id: 'B' } : null))
    expect(sendRedirect).toHaveBeenCalledWith(expect.anything(), '/acme/b-new', 301)
  })
})
