import { describe, expect, it, vi } from 'vitest'
import { maskEmail, rateLimitOk, safeRedirect, sendSignInLink } from '../server/utils/signin-link-core'

describe('maskEmail', () => {
  it('hides local part and domain, keeps first letter and tld', () => {
    expect(maskEmail('maarten@example.eu')).toBe('m•••@•••.eu')
  })
  it('never leaks on malformed input', () => {
    expect(maskEmail('nonsense')).toBe('•••')
  })
})

describe('safeRedirect', () => {
  it('keeps relative paths with query', () => {
    expect(safeRedirect('/api/status/login/velo?to=/x')).toBe('/api/status/login/velo?to=/x')
  })
  it('rejects absolute, protocol-relative and non-strings', () => {
    expect(safeRedirect('https://evil.com')).toBe('/')
    expect(safeRedirect('//evil.com')).toBe('/')
    expect(safeRedirect('/\\evil.com')).toBe('/')
    expect(safeRedirect(undefined)).toBe('/')
    expect(safeRedirect('/a\r\nb')).toBe('/')
    expect(safeRedirect(`/${'a'.repeat(500)}`)).toBe('/')
  })
})

describe('rateLimitOk', () => {
  it('allows first request and after the interval, blocks inside it', () => {
    expect(rateLimitOk(null, 1000)).toBe(true)
    expect(rateLimitOk(1000, 30_000)).toBe(false)
    expect(rateLimitOk(1000, 61_000)).toBe(true)
  })
})

describe('sendSignInLink', () => {
  it('passes the same request through to signInMagicLink', async () => {
    const fn = vi.fn().mockResolvedValue({})
    const headers = new Headers()
    await sendSignInLink({ signInMagicLink: fn }, { email: 'a@b.eu', callbackURL: '/x', headers })
    expect(fn).toHaveBeenCalledWith({ body: { email: 'a@b.eu', callbackURL: '/x' }, headers })
  })
  it('throws a 501 when the endpoint is missing', async () => {
    await expect(sendSignInLink({}, { email: 'a@b.eu', callbackURL: '/', headers: new Headers() }))
      .rejects.toMatchObject({ statusCode: 501 })
  })
})
