import { describe, it, expect } from 'vitest'
import { magicLinkCallbackURL } from '../../app/utils/magicLinkCallback'

const origin = 'https://app.example.com'

describe('magicLinkCallbackURL', () => {
  it('keeps a valid same-origin path with its query', () => {
    expect(magicLinkCallbackURL(origin, '/foo?x=1')).toBe(`${origin}/foo?x=1`)
  })

  it('falls back to the root with no redirect', () => {
    expect(magicLinkCallbackURL(origin)).toBe(`${origin}/`)
    expect(magicLinkCallbackURL(origin, null)).toBe(`${origin}/`)
  })

  it('rejects open-redirect shapes', () => {
    for (const bad of ['//evil.com', 'https://evil.com', '/\\evil.com', 'evil.com']) {
      expect(magicLinkCallbackURL(origin, bad)).toBe(`${origin}/`)
    }
  })
})
