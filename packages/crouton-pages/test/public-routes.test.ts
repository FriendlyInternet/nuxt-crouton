import { describe, it, expect, vi } from 'vitest'
import { createRouter, createMemoryHistory } from 'vue-router'
import { applyPublicRouteOptions, assertSingleLocale, rendersWithoutLocale } from '../app/utils/public-routes'

// #4191 — route order for the one-language setting, resolved by the real
// vue-router matcher (the code path that picks the page in production).

const Empty = { render: () => null }

/** The package's two public routes as Nuxt generates them, plus a static page. */
function nuxtPages() {
  return [
    { name: 'team-locale-slug', path: '/:team()/:locale()/:slug(.*)*' },
    { name: 'team-slug', path: '/:team()/:slug(.*)*' },
    { name: 'auth-login', path: '/auth/login' },
  ]
}

function resolverFor(pages: Array<{ name?: string, path: string }>) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: pages.map(p => ({ name: p.name, path: p.path, component: Empty })),
  })
  return (path: string) => {
    const r = router.resolve(path)
    return { name: r.name, params: r.params }
  }
}

describe('applyPublicRouteOptions — route order (T2)', () => {
  it('setting on (one locale): plain addresses go to team-slug, locale addresses to team-locale-slug', () => {
    const pages = nuxtPages()
    applyPublicRouteOptions(pages, { routingMode: 'team', hideLocaleInUrl: true, locales: ['en'] })
    expect(pages.find(p => p.name === 'team-locale-slug')!.path).toBe('/:team()/:locale(en)/:slug(.*)*')
    const resolve = resolverFor(pages)

    expect(resolve('/acme/about')).toEqual({ name: 'team-slug', params: { team: 'acme', slug: ['about'] } })
    expect(resolve('/acme/events/fair')).toEqual({ name: 'team-slug', params: { team: 'acme', slug: ['events', 'fair'] } })
    expect(resolve('/acme/en/about').name).toBe('team-locale-slug')
    expect(resolve('/acme/en/about').params).toMatchObject({ team: 'acme', locale: 'en', slug: ['about'] })
    expect(resolve('/acme/en').name).toBe('team-locale-slug')
    expect(resolve('/acme').name).toBe('team-slug')
    expect(resolve('/auth/login').name).toBe('auth-login')
  })

  it('setting on escapes regex characters in the locale code', () => {
    const pages = nuxtPages()
    applyPublicRouteOptions(pages, { routingMode: 'team', hideLocaleInUrl: true, locales: ['en.us'] })
    expect(pages[0]!.path).toBe('/:team()/:locale(en\\.us)/:slug(.*)*')
    const resolve = resolverFor(pages)
    expect(resolve('/acme/en.us/about').name).toBe('team-locale-slug')
    expect(resolve('/acme/enxus/about').name).toBe('team-slug')
  })

  it('setting off: paths untouched, resolution matches today', () => {
    const pages = nuxtPages()
    applyPublicRouteOptions(pages, { routingMode: 'team', hideLocaleInUrl: false, locales: ['fr', 'nl', 'en'] })
    expect(pages).toEqual(nuxtPages())
    const resolve = resolverFor(pages)

    // Today a no-locale page address is taken by the locale route (and 404s).
    expect(resolve('/acme/about')).toEqual({ name: 'team-locale-slug', params: { team: 'acme', locale: 'about' } })
    expect(resolve('/acme/en/about').params).toMatchObject({ team: 'acme', locale: 'en', slug: ['about'] })
    expect(resolve('/acme').name).toBe('team-slug')
    expect(resolve('/acme/en').name).toBe('team-locale-slug')
    expect(resolve('/auth/login').name).toBe('auth-login')
    expect(resolve('/acme/events/fair').params).toMatchObject({ team: 'acme', locale: 'events', slug: ['fair'] })
  })

  it.each(['locale', 'custom'])('%s mode removes both public routes', (routingMode) => {
    const pages = nuxtPages()
    applyPublicRouteOptions(pages, { routingMode, hideLocaleInUrl: false, locales: ['en'] })
    expect(pages.map(p => p.name)).toEqual(['auth-login'])
  })

  it.each(['locale', 'custom'])('%s mode with the setting on: warns, ignores it, does not throw', (routingMode) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const pages = nuxtPages()
    expect(() => applyPublicRouteOptions(pages, { routingMode, hideLocaleInUrl: true, locales: ['fr', 'nl'] })).not.toThrow()
    expect(pages.map(p => p.name)).toEqual(['auth-login'])
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('hideLocaleInUrl'))
    warn.mockRestore()
  })
})

describe('rendersWithoutLocale — the no-locale route\'s layout switch', () => {
  it('on only in team mode with the setting on', () => {
    expect(rendersWithoutLocale({ hideLocaleInUrl: true })).toBe(true)
    expect(rendersWithoutLocale({ hideLocaleInUrl: true, routingMode: 'team' })).toBe(true)
    expect(rendersWithoutLocale({ hideLocaleInUrl: true, routingMode: 'locale' })).toBe(false)
    expect(rendersWithoutLocale({ hideLocaleInUrl: true, routingMode: 'custom' })).toBe(false)
    expect(rendersWithoutLocale({ hideLocaleInUrl: false })).toBe(false)
    expect(rendersWithoutLocale({})).toBe(false)
    expect(rendersWithoutLocale(undefined)).toBe(false)
  })
})

describe('build refuses more than one locale (T3)', () => {
  it('throws naming the setting and the locales', () => {
    expect(() => applyPublicRouteOptions(nuxtPages(), { routingMode: 'team', hideLocaleInUrl: true, locales: ['fr', 'nl'] }))
      .toThrow(/hideLocaleInUrl.*fr, nl/)
  })

  it('does not throw with the setting off and two locales', () => {
    expect(() => applyPublicRouteOptions(nuxtPages(), { routingMode: 'team', hideLocaleInUrl: false, locales: ['fr', 'nl'] }))
      .not.toThrow()
  })

  it('assertSingleLocale returns the one code when on, null when off', () => {
    expect(assertSingleLocale(true, ['nl'])).toBe('nl')
    expect(assertSingleLocale(false, ['fr', 'nl'])).toBeNull()
    expect(() => assertSingleLocale(true, [])).toThrow(/hideLocaleInUrl/)
  })
})
