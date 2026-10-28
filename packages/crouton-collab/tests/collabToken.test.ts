import { describe, it, expect, vi, afterEach } from 'vitest'
import { signCollabToken, verifyCollabToken } from '../server/utils/collabToken'

describe('collab token', () => {
  afterEach(() => vi.useRealTimers())

  it('round-trips with the same secret', async () => {
    const token = await signCollabToken('user-1', 's3cret')
    expect(await verifyCollabToken(token, 's3cret')).toBe('user-1')
  })

  it('rejects a different secret', async () => {
    const token = await signCollabToken('user-1', 's3cret')
    expect(await verifyCollabToken(token, 'other')).toBeNull()
  })

  it('rejects a tampered payload', async () => {
    const token = await signCollabToken('user-1', 's3cret')
    const [, sig] = token.split('.')
    const forged = `${btoa(JSON.stringify({ userId: 'admin', exp: Date.now() + 60_000 }))}.${sig}`
    expect(await verifyCollabToken(forged, 's3cret')).toBeNull()
  })

  it('rejects an expired token', async () => {
    vi.useFakeTimers()
    const token = await signCollabToken('user-1', 's3cret', 1000)
    vi.advanceTimersByTime(2000)
    expect(await verifyCollabToken(token, 's3cret')).toBeNull()
  })

  it('fails loudly when signing without a secret, and verifies nothing without one', async () => {
    await expect(signCollabToken('u', undefined)).rejects.toThrow('COLLAB_TOKEN_SECRET')
    const token = await signCollabToken('u', 'x')
    expect(await verifyCollabToken(token, undefined)).toBeNull()
  })

  it('rejects malformed tokens', async () => {
    expect(await verifyCollabToken('garbage', 's')).toBeNull()
  })
})
