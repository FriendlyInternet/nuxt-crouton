import { describe, it, expect, vi } from 'vitest'
import { ghGet, isOwnerSession } from '../server/utils/github-core'

describe('ghGet', () => {
  it('errors without a token and never calls fetch', async () => {
    const f = vi.fn()
    expect(await ghGet('/x', undefined, f as any)).toEqual({ data: null, error: 'GITHUB_TOKEN is not configured' })
    expect(f).not.toHaveBeenCalled()
  })
  it('returns data with bearer auth', async () => {
    const f = vi.fn().mockResolvedValue({ ok: true, json: async () => [1] })
    const r = await ghGet('/repos/a/b', 't', f as any)
    expect(r).toEqual({ data: [1], error: null })
    expect(f.mock.calls[0][1].headers.Authorization).toBe('Bearer t')
  })
  it('reports HTTP and network failures as error', async () => {
    const bad = vi.fn().mockResolvedValue({ ok: false, status: 404, statusText: 'Not Found' })
    expect((await ghGet('/x', 't', bad as any)).error).toBe('GitHub 404 Not Found')
    const boom = vi.fn().mockRejectedValue(new Error('net'))
    expect((await ghGet('/x', 't', boom as any)).error).toBe('net')
  })
})

describe('isOwnerSession', () => {
  it('matches case-insensitively', () => expect(isOwnerSession({ user: { email: 'A@b.c' } }, 'a@B.c')).toBe(true))
  it('fails closed', () => {
    expect(isOwnerSession(null, 'a@b.c')).toBe(false)
    expect(isOwnerSession({ user: { email: 'x@b.c' } }, 'a@b.c')).toBe(false)
    expect(isOwnerSession({ user: { email: '' } }, '')).toBe(false)
  })
})
