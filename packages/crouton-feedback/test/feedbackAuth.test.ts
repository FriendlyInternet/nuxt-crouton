import { describe, it, expect, vi, beforeEach } from 'vitest'

// Rule (#3162): on a PR preview, only the preview's VERIFIED reviewer can post.
const state = vi.hoisted(() => ({
  config: {} as Record<string, unknown>,
  session: null as null | { user: { email?: string, emailVerified?: boolean } },
  authThrows: false,
  sink: vi.fn(async () => ({ ok: true, data: {} }))
}))

vi.mock('h3', () => ({
  defineEventHandler: (fn: unknown) => fn,
  readBody: async () => ({ commentText: 'hi', route: '/', cssSelector: '#a', boundingBox: { x: 0, y: 0, width: 1, height: 1 } }),
  setResponseStatus: vi.fn()
}))
vi.mock('nitropack/runtime', () => ({ useRuntimeConfig: () => ({ croutonFeedback: state.config }) }))
vi.mock('../src/runtime/server/sinks', () => ({
  resolveSink: () => state.sink,
  registeredSinks: () => ['test']
}))
vi.mock('@fyit/crouton-auth/server/utils/useServerAuth', () => ({
  getServerSession: async () => {
    if (state.authThrows) throw new Error('boom')
    return state.session
  }
}))

import handler from '../src/runtime/server/api/feedback.post'

const call = () => (handler as unknown as (e: unknown) => Promise<{ data: unknown, error: string | null }>)({})
const pr = (reviewerEmails: string) => ({ sink: 'test', githubPr: '5', reviewerEmails })

describe('feedback post — PR preview reviewer guard', () => {
  beforeEach(() => {
    state.sink.mockClear()
    state.session = null
    state.authThrows = false
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  it('refuses an anonymous caller; sink not called', async () => {
    state.config = pr('review+velo-pr5@example.com')
    expect((await call()).error).toBe('Not authorised')
    expect(state.sink).not.toHaveBeenCalled()
  })

  it('accepts the verified reviewer (case-insensitive)', async () => {
    state.config = pr('review+velo-pr5@example.com')
    state.session = { user: { email: 'Review+Velo-PR5@example.com', emailVerified: true } }
    expect((await call()).error).toBeNull()
    expect(state.sink).toHaveBeenCalled()
  })

  it('refuses the listed email when unverified (stranger pre-registered)', async () => {
    state.config = pr('review+velo-pr5@example.com')
    state.session = { user: { email: 'review+velo-pr5@example.com', emailVerified: false } }
    expect((await call()).error).toBe('Not authorised')
    expect(state.sink).not.toHaveBeenCalled()
  })

  it('refuses a verified stranger', async () => {
    state.config = pr('review+velo-pr5@example.com')
    state.session = { user: { email: 'other@x.com', emailVerified: true } }
    expect((await call()).error).toBe('Not authorised')
  })

  it('manual-dispatch shape: only the named PR account passes', async () => {
    state.config = pr('review+velo-pr7@example.com')
    state.session = { user: { email: 'review+velo-pr5@example.com', emailVerified: true } }
    expect((await call()).error).toBe('Not authorised')
    state.session = { user: { email: 'review+velo-pr7@example.com', emailVerified: true } }
    expect((await call()).error).toBeNull()
  })

  it('status shape: owner email accepted, anonymous refused', async () => {
    state.config = pr('owner@x.com')
    expect((await call()).error).toBe('Not authorised')
    state.session = { user: { email: 'owner@x.com', emailVerified: true } }
    expect((await call()).error).toBeNull()
  })

  it('fails closed: empty list, or auth import throwing', async () => {
    state.config = pr('')
    state.session = { user: { email: 'a@x.com', emailVerified: true } }
    expect((await call()).error).toBe('Not authorised')
    state.config = pr('a@x.com')
    state.authThrows = true
    expect((await call()).error).toBe('Not authorised')
    expect(state.sink).not.toHaveBeenCalled()
    expect(console.warn).toHaveBeenCalled()
  })

  it('non-PR sink is unchanged — no session needed', async () => {
    state.config = { sink: 'test', githubPr: '' }
    expect((await call()).error).toBeNull()
    expect(state.sink).toHaveBeenCalled()
  })
})
