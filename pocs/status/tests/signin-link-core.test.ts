import { describe, expect, it } from 'vitest'
import { createRateLimiter, maskEmail, safeRedirect } from '../server/utils/signin-link-core'

describe('maskEmail', () => {
  it('never reveals the full address', () => {
    expect(maskEmail('martin@example.eu')).toBe('m•••@•••.eu')
  })
  it('falls back for malformed input', () => {
    expect(maskEmail('nope')).toBe('•••')
  })
})

describe('safeRedirect', () => {
  it('keeps safe app paths', () => {
    expect(safeRedirect('/api/status/login/velo?to=/x')).toBe('/api/status/login/velo?to=/x')
  })
  it('rejects external and protocol-relative targets', () => {
    expect(safeRedirect('https://evil.test')).toBe('/')
    expect(safeRedirect('//evil.test')).toBe('/')
    expect(safeRedirect(undefined)).toBe('/')
  })
})

describe('createRateLimiter', () => {
  it('allows one send per window', () => {
    let t = 1000
    const allow = createRateLimiter(60_000, () => t)
    expect(allow('owner')).toBe(true)
    t += 30_000
    expect(allow('owner')).toBe(false)
    t += 31_000
    expect(allow('owner')).toBe(true)
  })
})
