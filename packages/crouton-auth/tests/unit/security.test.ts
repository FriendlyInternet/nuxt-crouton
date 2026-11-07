/**
 * sanitizeRedirectUrl / guest middleware — the redirect after login (#3138 R5)
 *
 * The rule: whatever comes out is on the app's own origin. Asserted by resolving the
 * result the way a browser does (tab/newline stripped from URLs) and comparing origins,
 * not by pinning one exact output.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { sanitizeRedirectUrl } from '../../app/utils/security'

const ORIGIN = 'https://app.example.com'

const attacks = [
  '/%09/example.com',
  '/\t/example.com',
  '/\n/example.com',
  '/\r/example.com',
  '//evil',
  '//evil.com/path',
  '/\\evil.com',
  'https://evil',
  'javascript:alert(1)',
  'data:text/html,hi',
  ''
]

function browserResolve(result: string): string {
  return new URL(result.replace(/[\t\n\r]/g, ''), ORIGIN).origin
}

describe('sanitizeRedirectUrl — result always stays on the app origin', () => {
  const realWindow = (globalThis as any).window

  afterEach(() => {
    ;(globalThis as any).window = realWindow
  })

  for (const withWindow of [true, false]) {
    describe(withWindow ? 'in the browser (window)' : 'without window (SSR / the old catch path)', () => {
      const setup = () => {
        if (withWindow) (globalThis as any).window = { location: { origin: ORIGIN } }
        else (globalThis as any).window = undefined
      }

      for (const input of attacks) {
        it(`${JSON.stringify(input)} resolves on-origin`, () => {
          setup()
          expect(browserResolve(sanitizeRedirectUrl(input))).toBe(ORIGIN)
        })
      }

      it('keeps a normal path with query and hash intact', () => {
        setup()
        expect(sanitizeRedirectUrl('/admin?x=1#frag')).toBe('/admin?x=1#frag')
      })

      it('keeps the invite page', () => {
        setup()
        expect(sanitizeRedirectUrl('/auth/accept-invitation/abc')).toBe('/auth/accept-invitation/abc')
      })
    })
  }
})
