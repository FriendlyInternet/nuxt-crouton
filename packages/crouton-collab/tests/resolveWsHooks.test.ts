import { describe, it, expect, vi } from 'vitest'
import { resolveWsHooks } from '../server/utils/resolveWsHooks'

describe('resolveWsHooks', () => {
  it('returns stock hooks when present', async () => {
    const router = vi.fn()
    const hooks = { open: () => {} }
    expect(await resolveWsHooks({ url: '/x' }, async () => hooks, router)).toBe(hooks)
    expect(router).not.toHaveBeenCalled()
  })

  it('falls back to the router when stock result is empty', async () => {
    const ws = { open: () => {} }
    const router = vi.fn(async () => ({ handler: { __websocket__: ws } }))
    const out = await resolveWsHooks({ request: { url: '/ws/room?a=1' } }, async () => ({}), router)
    expect(router).toHaveBeenCalledWith('/ws/room')
    expect(out).toBe(ws)
  })

  it('returns {} when the router has no __resolve__', async () => {
    expect(await resolveWsHooks({ url: '/x' }, async () => ({}), undefined)).toEqual({})
  })

  it('returns {} when the resolved handler has no websocket hooks', async () => {
    expect(await resolveWsHooks({ url: '/x' }, async () => ({}), async () => ({ handler: {} }))).toEqual({})
  })

  it('uses / for an unparseable URL and when no url is given', async () => {
    const router = vi.fn(async () => undefined)
    await resolveWsHooks({ url: 'http://[bad' }, async () => ({}), router)
    await resolveWsHooks({}, async () => ({}), router)
    expect(router).toHaveBeenNthCalledWith(1, '/')
    expect(router).toHaveBeenNthCalledWith(2, '/')
  })
})
