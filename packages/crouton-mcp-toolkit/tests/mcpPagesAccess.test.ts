/**
 * #3982 T7 — Rule A, token and mint side.
 *
 * - resolvePagesAccess: only an admin `mcp-pages` token opens the pages tools,
 *   and the team comes from the token.
 * - requireMcpAuth (the generic tools' check): refuses a pages token.
 * - POST /api/teams/:id/mcp-tokens { scope: 'pages' }: admin-only, 404 when the
 *   app has no pages handler, returns the /mcp/pages url.
 *
 * crouton-auth's DB-backed helpers are mocked: they need a live D1/SQLite with the
 * scoped-token table, which this package's unit run has no way to boot. The
 * mocks mirror their contracts (validateScopedToken → the row or null;
 * requireTeamAdmin → 403 below admin).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => {
  const g = globalThis as any
  g.defineEventHandler = (fn: any) => fn
  g.createError = (err: any) => Object.assign(new Error(err?.statusText || err?.message || 'error'), err)
  g.getHeader = (event: any, name: string) => event?.headers?.[name]
  g.readBody = async (event: any) => event?.__body
  g.getRequestURL = () => new URL('https://velo.test/api/teams/team_A/mcp-tokens')
  return {
    tokens: {} as Record<string, any>,
    role: 'admin' as 'admin' | 'member' | 'owner',
    runtime: { croutonMcpToolkit: { pages: true } } as any,
    created: [] as any[]
  }
})

;(globalThis as any).useRuntimeConfig = () => h.runtime

vi.mock('@fyit/crouton-auth/server/utils/scoped-access', () => ({
  validateScopedToken: async (token: string) => h.tokens[token] ?? null,
  createScopedToken: async (opts: any) => {
    h.created.push(opts)
    return { token: 'new-token', id: 'tok_new', expiresAt: new Date('2027-01-01T00:00:00Z') }
  }
}))

vi.mock('@fyit/crouton-auth/server/utils/team', () => {
  const ctx = () => ({ team: { id: 'team_A' }, user: { id: 'u1' }, membership: { role: h.role } })
  return {
    resolveTeamAndCheckMembership: async () => ctx(),
    requireTeamAdmin: async () => {
      const level = { owner: 3, admin: 2, member: 1 }[h.role]
      if (level < 2) throw Object.assign(new Error('Requires admin role or higher'), { status: 403 })
      return ctx()
    }
  }
})

import { resolvePagesAccess, pagesTokenFrom } from '../server/mcp-pages/lib/auth'
import { requireMcpAuth } from '../server/utils/mcp-auth'
import mintHandler from '../server/api/teams/[id]/mcp-tokens/index.post'

const pagesToken = { id: 'tok_p', organizationId: 'team_A', resourceType: 'mcp', resourceId: 'mcp-pages', role: 'admin' }
const generalToken = { id: 'tok_g', organizationId: 'team_A', resourceType: 'mcp', resourceId: 'mcp-toolkit', role: 'member' }

beforeEach(() => {
  h.tokens = {
    pages: pagesToken,
    general: generalToken,
    memberPages: { ...pagesToken, id: 'tok_m', role: 'member' },
    event: { id: 'tok_e', organizationId: 'team_A', resourceType: 'event', resourceId: 'mcp-pages', role: 'admin' }
  }
  h.role = 'admin'
  h.runtime = { croutonMcpToolkit: { pages: true } }
  h.created = []
})

// covers: T7
describe('resolvePagesAccess', () => {
  it('an admin mcp-pages token gives its own team and token id', async () => {
    expect(await resolvePagesAccess('pages')).toEqual({ teamId: 'team_A', tokenId: 'tok_p' })
  })
  it('refuses a general mcp-toolkit token, a member token, a non-mcp token and an unknown token', async () => {
    expect(await resolvePagesAccess('general')).toBeNull()
    expect(await resolvePagesAccess('memberPages')).toBeNull()
    expect(await resolvePagesAccess('event')).toBeNull()
    expect(await resolvePagesAccess('nope')).toBeNull()
    expect(await resolvePagesAccess('')).toBeNull()
    expect(await resolvePagesAccess(null)).toBeNull()
  })
  it('reads the token from ?token= or a Bearer header', () => {
    expect(pagesTokenFrom({ token: 'a' }, undefined)).toBe('a')
    expect(pagesTokenFrom({}, 'Bearer b')).toBe('b')
    expect(pagesTokenFrom({}, undefined)).toBeNull()
  })
})

// covers: T7
describe('requireMcpAuth (generic tools)', () => {
  const event = (token: string) => ({ headers: { authorization: `Bearer ${token}` } }) as any
  it('refuses a pages token with 403', async () => {
    await expect(requireMcpAuth(event('pages'), 'team_A')).rejects.toMatchObject({ status: 403, statusText: 'Token is not a general MCP token' })
  })
  it('still accepts a general mcp-toolkit token for its own team', async () => {
    await expect(requireMcpAuth(event('general'), 'team_A')).resolves.toMatchObject({ id: 'tok_g' })
    await expect(requireMcpAuth(event('general'), 'team_B')).rejects.toMatchObject({ status: 403 })
  })
})

// covers: T7
describe('POST /api/teams/:id/mcp-tokens', () => {
  const post = (body: any) => (mintHandler as any)({ __body: body })

  it('scope pages: a member session gets 403 and nothing is created', async () => {
    h.role = 'member'
    await expect(post({ scope: 'pages' })).rejects.toMatchObject({ status: 403 })
    expect(h.created).toEqual([])
  })

  it('scope pages: 404 when the app has no pages handler, nothing created', async () => {
    h.runtime = { croutonMcpToolkit: {} }
    await expect(post({ scope: 'pages' })).rejects.toMatchObject({ status: 404, statusText: 'pages tools are not enabled in this app' })
    h.runtime = {}
    await expect(post({ scope: 'pages' })).rejects.toMatchObject({ status: 404 })
    expect(h.created).toEqual([])
  })

  it('scope pages: an admin mints an admin mcp-pages token plus the /mcp/pages url', async () => {
    const res = await post({ scope: 'pages' })
    expect(h.created).toHaveLength(1)
    expect(h.created[0]).toMatchObject({ organizationId: 'team_A', resourceType: 'mcp', resourceId: 'mcp-pages', role: 'admin' })
    expect(res).toMatchObject({ token: 'new-token', teamId: 'team_A', url: 'https://velo.test/mcp/pages?token=new-token' })
  })

  it('default scope still mints a member mcp-toolkit token (no url)', async () => {
    h.role = 'member'
    const res = await post({})
    expect(h.created[0]).toMatchObject({ resourceId: 'mcp-toolkit', role: 'member' })
    expect(res.url).toBeUndefined()
  })
})
