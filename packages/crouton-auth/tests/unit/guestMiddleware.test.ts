/**
 * guest middleware — a signed-in user on a guest page is never sent off-origin (#3138 R5)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const navigateTo = vi.fn()

beforeEach(() => {
  navigateTo.mockReset()
  vi.stubGlobal('defineNuxtRouteMiddleware', (fn: unknown) => fn)
  vi.stubGlobal('useAuthConfig', () => ({ ui: { redirects: { authenticated: '/home' } } }))
  vi.stubGlobal('useSession', () => ({ isAuthenticated: { value: true }, isPending: { value: false } }))
  vi.stubGlobal('navigateTo', navigateTo)
})

async function run(redirect?: string) {
  const mod = await import('../../app/middleware/guest')
  await (mod.default as any)({ query: redirect === undefined ? {} : { redirect }, path: '/auth/login' })
  return navigateTo.mock.calls[0]![0] as string
}

const origin = (globalThis as any).window.location.origin

describe('guest middleware redirect', () => {
  for (const bad of ['//evil', 'https://evil', 'javascript:alert(1)', '/\t/example.com', '/\n/example.com', '/%09/example.com']) {
    it(`${JSON.stringify(bad)} stays on the app origin`, async () => {
      const target = await run(bad)
      expect(new URL(target.replace(/[\t\n\r]/g, ''), origin).origin).toBe(origin)
    })
  }

  it('keeps a safe local path with query and hash', async () => {
    expect(await run('/admin?x=1#frag')).toBe('/admin?x=1#frag')
  })

  it('falls back to the configured authenticated route', async () => {
    expect(await run()).toBe('/home')
  })
})
