import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createError } from 'h3'
import { createStorage } from 'unstorage'
import cloudflareKvBinding from 'unstorage/drivers/cloudflare-kv-binding'
import memory from 'unstorage/drivers/memory'

// Drives the REAL handler (server/api/status/signin-link.post.ts) with Nitro globals stubbed.
// `useStorage('kv')` is one real cloudflare-kv-binding driver over a Map-backed fake binding that
// outlives every "isolate"; any other storage name gets fresh memory per boot, like a new Worker.

const OWNER = 'owner@example.test'
let kvPuts: Array<{ key: string, opts: any }>
let kvMap: Map<string, string>
let send: ReturnType<typeof vi.fn>
let owner = OWNER

function fakeBinding() {
  return {
    get: async (k: string) => kvMap.get(k) ?? null,
    getWithMetadata: async (k: string) => ({ value: kvMap.get(k) ?? null, metadata: null }),
    put: async (k: string, v: string, opts: any) => { kvMap.set(k, v); kvPuts.push({ key: k, opts }) },
    delete: async (k: string) => { kvMap.delete(k) },
    list: async () => ({ keys: [...kvMap.keys()].map(name => ({ name })), list_complete: true })
  }
}

async function bootIsolate() {
  vi.resetModules()
  const kv = createStorage({ driver: cloudflareKvBinding({ binding: fakeBinding() as any }) })
  const mem = createStorage({ driver: memory() })
  vi.stubGlobal('defineEventHandler', (h: unknown) => h)
  vi.stubGlobal('setHeader', () => {})
  vi.stubGlobal('createError', createError)
  vi.stubGlobal('useRuntimeConfig', () => ({ statusOwnerEmail: owner }))
  vi.stubGlobal('readBody', async (e: any) => e.body)
  vi.stubGlobal('getRequestHeader', (e: any, n: string) => e.headers.get(n) ?? undefined)
  vi.stubGlobal('getRequestIP', () => undefined)
  vi.stubGlobal('useServerAuth', () => ({ api: { signInMagicLink: send } }))
  vi.stubGlobal('useStorage', (name: string) => (name === 'kv' ? kv : mem))
  return (await import('../server/api/status/signin-link.post')).default as unknown as (e: unknown) => Promise<any>
}

const ev = (ip?: string) => ({ body: { redirect: '/' }, headers: new Headers(ip ? { 'cf-connecting-ip': ip } : {}) })
const status = async (p: Promise<unknown>) => p.then(() => 200, (e: any) => e.statusCode)

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-11-01T10:00:00Z'))
  kvMap = new Map()
  kvPuts = []
  owner = OWNER
  send = vi.fn(async () => {})
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('POST /api/status/signin-link', () => {
  it('limit is shared across Worker instances (same IP, second isolate -> 429)', async () => {
    const a = await bootIsolate()
    expect((await a(ev('1.1.1.1'))).sent).toBe(true)
    const b = await bootIsolate()
    expect(await status(b(ev('1.1.1.1')))).toBe(429)
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('a failed send uses up nothing', async () => {
    const h = await bootIsolate()
    send.mockRejectedValueOnce(new Error('mail down'))
    expect(await status(h(ev('1.1.1.1')))).toBe(502)
    expect(kvMap.size).toBe(0)
    expect((await h(ev('1.1.1.1'))).sent).toBe(true)
  })

  it('different IPs are not blocked by each other; the same IP is', async () => {
    const h = await bootIsolate()
    expect((await h(ev('1.1.1.1'))).sent).toBe(true)
    vi.setSystemTime(Date.now() + 1000)
    expect((await h(ev('2.2.2.2'))).sent).toBe(true)
    expect(await status(h(ev('1.1.1.1')))).toBe(429)
  })

  it('same IP is allowed again after 61 s', async () => {
    const h = await bootIsolate()
    await h(ev('1.1.1.1'))
    vi.setSystemTime(Date.now() + 61_000)
    expect((await h(ev('1.1.1.1'))).sent).toBe(true)
  })

  it('global cap: 10 per hour across IPs, resets next hour', async () => {
    const h = await bootIsolate()
    for (let i = 1; i <= 10; i++) expect((await h(ev(`9.9.9.${i}`))).sent).toBe(true)
    expect(await status(h(ev('9.9.9.99')))).toBe(429)
    vi.setSystemTime(new Date('2026-11-01T11:00:01Z'))
    expect((await h(ev('9.9.9.99'))).sent).toBe(true)
  })

  it('owner email unset -> 503, nothing sent or stored', async () => {
    owner = ''
    const h = await bootIsolate()
    expect(await status(h(ev('1.1.1.1')))).toBe(503)
    expect(send).not.toHaveBeenCalled()
    expect(kvMap.size).toBe(0)
  })

  it('magic link not enabled -> 501, nothing stored', async () => {
    const h = await bootIsolate()
    send.mockRejectedValueOnce(Object.assign(new Error('x'), { statusCode: 501 }))
    expect(await status(h(ev('1.1.1.1')))).toBe(501)
    expect(kvMap.size).toBe(0)
  })

  it('no client IP: no shared per-IP counter, only the global count moves', async () => {
    const h = await bootIsolate()
    expect((await h(ev())).sent).toBe(true)
    expect((await h(ev())).sent).toBe(true)
    expect(kvMap.size).toBe(1)
    expect([...kvMap.values()][0]).toBe('2')
  })

  it('writes use KV-valid TTLs (120 for the IP key, 3700 for the global key)', async () => {
    const h = await bootIsolate()
    await h(ev('1.1.1.1'))
    expect(kvPuts.find(p => p.key.includes(':ip:'))?.opts.expirationTtl).toBe(120)
    expect(kvPuts.find(p => p.key.includes(':global:'))?.opts.expirationTtl).toBe(3700)
  })
})
