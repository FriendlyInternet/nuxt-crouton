import { describe, it, expect, vi, afterEach } from 'vitest'
import { signCollabToken, verifyCollabToken } from '../server/utils/collabToken'

const claims = { userId: 'user-1', teamId: 'tA', room: 'tA:page:1' }

describe('collab token', () => {
  afterEach(() => vi.useRealTimers())

  it('round-trips userId, teamId and room', async () => {
    const token = await signCollabToken(claims, 's3cret')
    expect(await verifyCollabToken(token, 's3cret')).toEqual(claims)
  })

  it('rejects a different secret', async () => {
    const token = await signCollabToken(claims, 's3cret')
    expect(await verifyCollabToken(token, 'other')).toBeNull()
  })

  it('rejects a tampered team or room', async () => {
    const token = await signCollabToken(claims, 's3cret')
    const [, sig] = token.split('.')
    for (const forgedClaims of [{ ...claims, teamId: 'tB' }, { ...claims, room: 'tA:page:2' }]) {
      const forged = `${btoa(JSON.stringify({ ...forgedClaims, exp: Date.now() + 60_000 }))}.${sig}`
      expect(await verifyCollabToken(forged, 's3cret')).toBeNull()
    }
  })

  it('rejects an expired token', async () => {
    vi.useFakeTimers()
    const token = await signCollabToken(claims, 's3cret', 1000)
    vi.advanceTimersByTime(2000)
    expect(await verifyCollabToken(token, 's3cret')).toBeNull()
  })

  it('fails loudly when signing without a secret, and verifies nothing without one', async () => {
    await expect(signCollabToken(claims, undefined)).rejects.toThrow('COLLAB_TOKEN_SECRET')
    const token = await signCollabToken(claims, 'x')
    expect(await verifyCollabToken(token, undefined)).toBeNull()
  })

  it('rejects malformed tokens', async () => {
    expect(await verifyCollabToken('garbage', 's')).toBeNull()
  })
})
