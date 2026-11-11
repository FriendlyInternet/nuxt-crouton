/**
 * #3143 — sanitizeRedirectUrl: after sign-in a user only ever lands on this
 * site. Checked as a RULE (the resolved output stays same-origin) over hostile
 * inputs, not as exact outputs.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { sanitizeRedirectUrl } from '../../app/utils/security'

const HOSTILE_REDIRECTS = [
  '/%09/example.com',
  '/\t/example.com',
  '/\n/example.com',
  '\t//evil.com',
  '//evil',
  'https://evil',
  '/\\evil.com',
  'javascript:alert(1)',
  '/.//evil.com',
  '/..//evil.com',
  '/a/..//evil.com',
  'http://localhost:3000//evil.com',
  ''
]

const staysOnSite = (out: string) => new URL(out, window.location.origin).origin === window.location.origin

describe('sanitizeRedirectUrl', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  it.each(HOSTILE_REDIRECTS)('keeps %j on this site', (input) => {
    const out = sanitizeRedirectUrl(input)
    expect(staysOnSite(out)).toBe(true)
    expect(out.startsWith('/')).toBe(true)
    expect(out.startsWith('//')).toBe(false)
  })

  it('keeps a same-origin path with query and hash', () => {
    expect(sanitizeRedirectUrl('/admin/test1?x=1#h')).toBe('/admin/test1?x=1#h')
  })

  it('turns a same-origin absolute URL into a path', () => {
    expect(sanitizeRedirectUrl('http://localhost:3000/foo')).toBe('/foo')
  })
})
