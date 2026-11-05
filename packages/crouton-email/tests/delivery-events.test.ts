import { describe, it, expect } from 'vitest'
import { translateResendEvent, verifyResendSignature, isEmailProblem } from '../server/utils/delivery-events'

const secretBytes = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])
const secret = `whsec_${btoa(String.fromCharCode(...secretBytes))}`

async function sign(id: string, ts: string, body: string) {
  const key = await crypto.subtle.importKey('raw', secretBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${id}.${ts}.${body}`))
  return `v1,${btoa(String.fromCharCode(...new Uint8Array(mac)))}`
}

describe('translateResendEvent', () => {
  it.each([
    ['email.delivered', 'delivered'],
    ['email.bounced', 'bounced'],
    ['email.delivery_delayed', 'delayed'],
    ['email.complained', 'complained']
  ])('maps %s to %s', (type, state) => {
    expect(translateResendEvent({ type, data: { email_id: 'abc' } })).toMatchObject({ providerId: 'abc', state })
  })

  it('ignores untracked events and malformed bodies', () => {
    expect(translateResendEvent({ type: 'email.opened', data: { email_id: 'abc' } })).toBeNull()
    expect(translateResendEvent({ type: 'email.bounced', data: {} })).toBeNull()
    expect(translateResendEvent(null)).toBeNull()
  })
})

describe('verifyResendSignature', () => {
  const body = '{"type":"email.delivered"}'
  const ts = '1700000000'

  it('accepts a valid signature', async () => {
    const signature = await sign('msg_1', ts, body)
    expect(await verifyResendSignature(body, { id: 'msg_1', timestamp: ts, signature }, secret, { now: 1700000010 })).toBe(true)
  })

  it('accepts when one of several rotated signatures matches', async () => {
    const signature = `v1,bogus ${await sign('msg_1', ts, body)}`
    expect(await verifyResendSignature(body, { id: 'msg_1', timestamp: ts, signature }, secret, { now: 1700000010 })).toBe(true)
  })

  it('rejects a tampered body, stale timestamp, or missing headers', async () => {
    const signature = await sign('msg_1', ts, body)
    expect(await verifyResendSignature(body + ' ', { id: 'msg_1', timestamp: ts, signature }, secret, { now: 1700000010 })).toBe(false)
    expect(await verifyResendSignature(body, { id: 'msg_1', timestamp: ts, signature }, secret, { now: 1700009999 })).toBe(false)
    expect(await verifyResendSignature(body, { id: null, timestamp: ts, signature }, secret, { now: 1700000010 })).toBe(false)
  })
})

describe('isEmailProblem', () => {
  const now = 1_000_000_000_000
  it('flags bounced, complained and failed', () => {
    for (const status of ['bounced', 'complained', 'failed']) {
      expect(isEmailProblem({ status, createdAt: now }, now)).toBe(true)
    }
  })
  it('flags sent with no confirmation after 15 min, not before', () => {
    expect(isEmailProblem({ status: 'sent', createdAt: now - 16 * 60_000 }, now)).toBe(true)
    expect(isEmailProblem({ status: 'sent', createdAt: now - 5 * 60_000 }, now)).toBe(false)
  })
  it('never flags delivered', () => {
    expect(isEmailProblem({ status: 'delivered', createdAt: now - 99 * 60_000 }, now)).toBe(false)
  })
})
