import { describe, it, expect, vi, beforeEach } from 'vitest'

let user: { id: string } | null = null
const upstream = vi.fn(async () => [])
vi.stubGlobal('defineEventHandler', (fn: any) => fn)
vi.stubGlobal('createError', (o: any) => Object.assign(new Error(o.statusText), o))
vi.stubGlobal('useRuntimeConfig', () => ({}))
vi.stubGlobal('getQuery', () => ({ q: 'amsterdam' }))
vi.stubGlobal('$fetch', upstream)
vi.stubGlobal('requireAuth', async () => {
  if (!user) throw Object.assign(new Error('Unauthorized'), { status: 401 })
  return user
})

const call = async () => ((await import('../api/maps/geocode.get')).default as any)({})

beforeEach(() => { upstream.mockClear() })

describe('geocode auth', () => {
  it('no session -> 401, upstream not fetched', async () => {
    user = null
    await expect(call()).rejects.toMatchObject({ status: 401 })
    expect(upstream).not.toHaveBeenCalled()
  })
  it('31st call in a minute -> 429; another user unaffected', async () => {
    user = { id: 'heavy' }
    for (let i = 0; i < 30; i++) await call()
    await expect(call()).rejects.toMatchObject({ status: 429 })
    user = { id: 'other' }
    await expect(call()).resolves.toBeTruthy()
  })
})
