import { describe, it, expect, vi, beforeEach } from 'vitest'
import { signInternalRequest } from '../server/utils/internalSignature'

const callHook = vi.fn().mockResolvedValue(undefined)
vi.mock('nitropack/runtime', () => ({ useNitroApp: () => ({ hooks: { callHook } }) }))

let headers: Record<string, string> = {}
let raw = ''
vi.stubGlobal('defineEventHandler', (fn: any) => fn)
vi.stubGlobal('readRawBody', async () => raw)
vi.stubGlobal('getHeader', (_e: unknown, n: string) => headers[n])
vi.stubGlobal('createError', (o: any) => Object.assign(new Error(o.statusText), o))

const SECRET = 'test-secret'
const body = JSON.stringify({ type: 'collab:save', teamId: 'team-a', metadata: {} })

async function call() {
  const handler = (await import('../server/api/_crouton/operation.post')).default as any
  return handler({})
}
async function signed(b: string, ts = String(Date.now())) {
  return { 'x-crouton-timestamp': ts, 'x-crouton-signature': await signInternalRequest(SECRET, ts, b) }
}

describe('POST /_crouton/operation auth', () => {
  beforeEach(() => {
    callHook.mockClear()
    process.env.COLLAB_TOKEN_SECRET = SECRET
    raw = body
    headers = {}
  })

  it('rejects an unsigned request', async () => {
    await expect(call()).rejects.toMatchObject({ status: 401 })
    expect(callHook).not.toHaveBeenCalled()
  })
  it('rejects a wrong signature', async () => {
    headers = { 'x-crouton-timestamp': String(Date.now()), 'x-crouton-signature': 'ab'.repeat(32) }
    await expect(call()).rejects.toMatchObject({ status: 401 })
  })
  it('rejects a stale timestamp', async () => {
    headers = await signed(body, String(Date.now() - 60_000))
    await expect(call()).rejects.toMatchObject({ status: 401 })
  })
  it('rejects everything when the secret is unset', async () => {
    headers = await signed(body)
    delete process.env.COLLAB_TOKEN_SECRET
    await expect(call()).rejects.toMatchObject({ status: 401 })
  })
  it('rejects a signature reused with a different body', async () => {
    headers = await signed(body)
    raw = JSON.stringify({ type: 'collab:save', teamId: 'team-b' })
    await expect(call()).rejects.toMatchObject({ status: 401 })
    expect(callHook).not.toHaveBeenCalled()
  })
  it('accepts a valid signature and emits once with the signed team', async () => {
    headers = await signed(body)
    await expect(call()).resolves.toEqual({ ok: true })
    expect(callHook).toHaveBeenCalledTimes(1)
    expect(callHook.mock.calls[0][1]).toMatchObject({ teamId: 'team-a' })
  })
})
