import { afterEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

// Signed-out visits must end on /signin (#3000). Real code paths: the app's nuxt.config, the
// crouton-auth `auth` middleware that pages/index.vue uses, and the real login/[app] handler.

afterEach(() => {
  vi.unstubAllGlobals()
  vi.resetModules()
})

describe('signed-out routing', () => {
  it('/ (auth middleware) navigates to /signin with the return path', async () => {
    vi.stubGlobal('defineNuxtConfig', (c: unknown) => c)
    const cfg = (await import('../nuxt.config')).default as any
    const navigateTo = vi.fn((x: unknown) => x)
    vi.stubGlobal('useRuntimeConfig', () => ({ public: { crouton: { auth: cfg.croutonAuth } } }))
    vi.stubGlobal('useSession', () => ({ isAuthenticated: ref(false), isPending: ref(false) }))
    vi.stubGlobal('navigateTo', navigateTo)
    vi.stubGlobal('defineNuxtRouteMiddleware', (m: unknown) => m)
    const { useAuthConfig } = await import('../../../packages/crouton-auth/app/composables/useAuthConfig')
    vi.stubGlobal('useAuthConfig', useAuthConfig)
    const mw = (await import('../../../packages/crouton-auth/app/middleware/auth')).default as any
    await mw({ fullPath: '/', path: '/' })
    expect(navigateTo).toHaveBeenCalledWith({ path: '/signin', query: { redirect: '/' } })
  })

  async function loginHandler() {
    vi.stubGlobal('defineEventHandler', (h: unknown) => h)
    vi.stubGlobal('defineCachedFunction', (f: unknown) => f)
    vi.stubGlobal('setHeader', () => {})
    vi.stubGlobal('useRuntimeConfig', () => ({}))
    vi.stubGlobal('useServerAuth', () => ({ api: { getSession: async () => null } }))
    vi.stubGlobal('getRouterParam', (e: any) => e.app)
    vi.stubGlobal('sendRedirect', (_e: unknown, loc: string, code: number) => ({ loc, code }))
    return (await import('../server/api/status/login/[app].get')).default as unknown as (e: unknown) => Promise<any>
  }

  it('/api/status/login/<app> signed out -> 302 to /signin returning here', async () => {
    const h = await loginHandler()
    expect(await h({ app: 'velo' })).toEqual({ loc: '/signin?redirect=%2Fapi%2Fstatus%2Flogin%2Fvelo', code: 302 })
  })

  it('a bad slug falls back to /', async () => {
    const h = await loginHandler()
    expect((await h({ app: '../x' })).loc).toBe('/signin?redirect=%2F')
  })
})
