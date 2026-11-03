import { describe, expect, it } from 'vitest'
import { maskEmail, rateLimitOk, safeRedirect } from '../server/utils/signin-link-core'

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
  })
})

describe('rateLimitOk', () => {
  it('allows first request and after the interval, blocks inside it', () => {
    expect(rateLimitOk(null, 1000)).toBe(true)
    expect(rateLimitOk(1000, 30_000)).toBe(false)
    expect(rateLimitOk(1000, 61_000)).toBe(true)
  })
})
