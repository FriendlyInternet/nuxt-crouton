/**
 * #3143 — the guest middleware (real file) must never send a signed-in user
 * off-site via `?redirect=`.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'
import { ref } from 'vue'

const HOSTILE_REDIRECTS = [
  '/%09/example.com',
  '/\t/example.com',
  '/\n/example.com',
  '\t//evil.com',
  '//evil',
  'https://evil',
  'https://example.com',
  '/\\evil.com',
  'javascript:alert(1)',
  '/.//evil.com',
  '/..//evil.com',
  '/a/..//evil.com',
  'http://localhost:3000//evil.com'
]

const staysOnSite = (out: string) => new URL(out, window.location.origin).origin === window.location.origin

const navigateTo = vi.fn()
let authConfig: any = {}
let authenticated = true
let middleware: (to: any) => Promise<unknown>

beforeAll(async () => {
  vi.stubGlobal('defineNuxtRouteMiddleware', (fn: any) => fn)
  vi.stubGlobal('useAuthConfig', () => authConfig)
  vi.stubGlobal('useSession', () => ({ isAuthenticated: ref(authenticated), isPending: ref(false) }))
  vi.stubGlobal('navigateTo', navigateTo)
  middleware = (await import('../../app/middleware/guest')).default as any
})

beforeEach(() => {
  navigateTo.mockReset()
  authConfig = {}
  authenticated = true
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

describe('guest middleware ?redirect', () => {
  it.each(HOSTILE_REDIRECTS)('signed in + redirect=%j stays on this site', async (redirect) => {
    await middleware({ path: '/auth/login', query: { redirect } })
    expect(navigateTo).toHaveBeenCalledTimes(1)
    const [target, opts] = navigateTo.mock.calls[0]!
    expect(staysOnSite(target)).toBe(true)
    expect(target.startsWith('//')).toBe(false)
    expect(opts).toEqual({ replace: true, external: true })
  })

  it('signed in + same-site redirect is kept', async () => {
    await middleware({ path: '/auth/login', query: { redirect: '/admin/test1' } })
    expect(navigateTo).toHaveBeenCalledWith('/admin/test1', { replace: true, external: true })
  })

  it('signed in, no redirect → configured authenticated redirect', async () => {
    authConfig = { ui: { redirects: { authenticated: '/dash' } } }
    await middleware({ path: '/auth/login', query: {} })
    expect(navigateTo).toHaveBeenCalledWith('/dash', { replace: true, external: true })
  })

  it('signed out → no navigation', async () => {
    authenticated = false
    await middleware({ path: '/auth/login', query: { redirect: 'https://evil' } })
    expect(navigateTo).not.toHaveBeenCalled()
  })
})
