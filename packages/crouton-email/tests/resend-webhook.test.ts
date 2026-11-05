import { describe, it, expect, vi, beforeEach } from 'vitest'

const secretBytes = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])
const secret = `whsec_${btoa(String.fromCharCode(...secretBytes))}`
const callHook = vi.fn()
let headers: Record<string, string> = {}
let raw = ''

async function sign(id: string, ts: string, body: string) {
  const key = await crypto.subtle.importKey('raw', secretBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${id}.${ts}.${body}`))
  return `v1,${btoa(String.fromCharCode(...new Uint8Array(mac)))}`
}

async function load(withSecret = true) {
  vi.stubGlobal('defineEventHandler', (fn: any) => fn)
  vi.stubGlobal('useRuntimeConfig', () => ({ email: withSecret ? { resendWebhookSecret: secret } : {} }))
  vi.stubGlobal('readRawBody', async () => raw)
  vi.stubGlobal('getHeader', (_e: any, k: string) => headers[k])
  vi.stubGlobal('useNitroApp', () => ({ hooks: { callHook } }))
  vi.stubGlobal('createError', (o: any) => Object.assign(new Error(o.statusMessage), o))
  vi.resetModules()
  return (await import('../server/api/webhooks/resend.post')).default as (e: any) => Promise<any>
}

async function signed(payload: unknown) {
  raw = JSON.stringify(payload)
  const ts = String(Math.floor(Date.now() / 1000))
  headers = { 'svix-id': 'msg_1', 'svix-timestamp': ts, 'svix-signature': await sign('msg_1', ts, raw) }
}

describe('POST /api/webhooks/resend', () => {
  beforeEach(() => callHook.mockReset())

  it('emits crouton:email:delivery with state bounced for a bounce', async () => {
    const handler = await load()
    await signed({ type: 'email.bounced', data: { email_id: 'e1', to: ['a@b.co'], bounce: { message: 'mailbox full' } } })
    expect(await handler({})).toEqual({ ok: true })
    expect(callHook).toHaveBeenCalledWith('crouton:email:delivery', expect.objectContaining({ to: 'a@b.co', state: 'bounced' }))
  })

  it('emits delivered for a normal email', async () => {
    const handler = await load()
    await signed({ type: 'email.delivered', data: { email_id: 'e1', to: ['a@b.co'] } })
    await handler({})
    expect(callHook).toHaveBeenCalledWith('crouton:email:delivery', expect.objectContaining({ state: 'delivered' }))
  })

  it('rejects a bad signature with 401 and emits nothing', async () => {
    const handler = await load()
    await signed({ type: 'email.bounced', data: { email_id: 'e1', to: ['a@b.co'] } })
    headers['svix-signature'] = 'v1,AAAA'
    await expect(handler({})).rejects.toMatchObject({ statusCode: 401 })
    expect(callHook).not.toHaveBeenCalled()
  })

  it('returns 503 when no secret is configured', async () => {
    const handler = await load(false)
    await expect(handler({})).rejects.toMatchObject({ statusCode: 503 })
  })
})
