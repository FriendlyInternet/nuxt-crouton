/**
 * #4191 × #4175 — a connected domain with the one-language setting on.
 *
 * Runs the real pieces in the order production does: the domain resolver Nitro
 * plugin rewrites the request, the public routes are pinned by
 * applyPublicRouteOptions and matched by the real vue-router, useDomainContext
 * reads the context the plugin set, links are built by buildPagePath /
 * buildBinderBasePath with those flags, and the team-host history turns them
 * into the hrefs a visitor sees. Stubbed: the database (one verified domain,
 * booking.acme.com → team `acme`) and Nuxt's useState, which on the server
 * holds exactly the plugin's event context.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { computed, ref } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import { applyPublicRouteOptions } from '../app/utils/public-routes'
import { buildBinderBasePath, buildPagePath } from '../app/utils/page-path'
import { stripTeamPrefix } from '../app/utils/custom-domain-path'
import { teamHostHistory } from '../app/utils/team-host-history'

vi.mock('@fyit/crouton-auth/server/database/schema/auth', () => ({
  domain: { __table: 'domain', domain: 'domain.domain', organizationId: 'domain.organizationId', status: 'domain.status' },
  organization: { __table: 'organization', id: 'organization.id', slug: 'organization.slug' },
  teamSettings: { __table: 'teamSettings', teamId: 'teamSettings.teamId', siteSettings: 'teamSettings.siteSettings' }
}))
vi.mock('drizzle-orm', () => ({
  eq: (col: unknown, val: unknown) => ({ col, val }),
  and: (...conds: unknown[]) => ({ and: conds })
}))

const pagesConfig = { appDomains: ['pmcp.dev'], routingMode: 'team', hideLocaleInUrl: true }

function fakeDB() {
  return {
    select: () => ({
      from: (table: { __table: string }) => {
        const rows = table.__table === 'domain'
          ? [{ domain: 'booking.acme.com', organizationId: 'T1', status: 'verified' }]
          : table.__table === 'organization'
            ? [{ slug: 'acme' }]
            : [{ siteSettings: { publicSiteEnabled: true } }]
        const chain = {
          where: () => chain,
          limit: () => chain,
          then: (fn: (r: unknown[]) => unknown) => Promise.resolve(fn(rows))
        }
        return chain
      }
    })
  }
}

let ssrState: Record<string, unknown> | null = null
const g = globalThis as Record<string, unknown>
g.defineNitroPlugin = (fn: unknown) => fn
g.defineEventHandler = (fn: unknown) => fn
g.getRequestHost = (event: { host: string }) => event.host
g.useRuntimeConfig = () => ({ public: { croutonPages: pagesConfig } })
g.useDB = fakeDB
g.useNuxtApp = () => ({})
g.useRequestEvent = () => null
g.useState = (_key: string, init: () => unknown) => ref(ssrState ?? init())
g.computed = computed

interface FakeEvent {
  host: string
  node: { req: { url: string } }
  context: Record<string, any>
}

/** Run the real domain resolver plugin on one request. */
async function serve(url: string, host = 'booking.acme.com') {
  const { default: plugin } = await import('../server/plugins/domain-resolver')
  let seen = ''
  const nitroApp = { h3App: { handler: async (event: FakeEvent) => { seen = event.node.req.url } } }
  ;(plugin as unknown as (app: typeof nitroApp) => void)(nitroApp)
  const event: FakeEvent = { host, node: { req: { url } }, context: {} }
  await nitroApp.h3App.handler(event)
  return { url: seen, context: event.context }
}

/** The domain context the app sees, built from the plugin's request context. */
async function domainContextFor(context: FakeEvent['context']) {
  ssrState = {
    isCustomDomain: context.isCustomDomain || false,
    routingMode: context.routingMode || pagesConfig.routingMode,
    resolvedDomain: context.resolvedDomain || null,
    resolvedTeamId: context.resolvedDomainTeamId || null,
    resolvedTeamSlug: context.resolvedDomainTeamSlug || null,
    appSegments: context.resolvedDomainAppSegments || []
  }
  const { useDomainContext } = await import('../app/composables/useDomainContext')
  return useDomainContext()
}

const Empty = { render: () => null }

/** The package's public routes as Nuxt generates them, pinned for the setting. */
function publicRouter(
  teamSlug: string,
  appSegments: string[],
  locales: string[],
  history = teamHostHistory(createMemoryHistory(), teamSlug, appSegments)
) {
  const pages = [
    { name: 'account', path: '/account' },
    { name: 'team-locale-slug', path: '/:team()/:locale()/:slug(.*)*' },
    { name: 'team-slug', path: '/:team()/:slug(.*)*' }
  ]
  applyPublicRouteOptions(pages, { routingMode: 'team', hideLocaleInUrl: pagesConfig.hideLocaleInUrl, locales })
  return createRouter({
    history,
    routes: pages.map(p => ({ name: p.name, path: p.path, component: Empty }))
  })
}

describe('connected domain + one-language setting on', () => {
  beforeEach(() => {
    pagesConfig.hideLocaleInUrl = true
    ssrState = null
  })

  // covers: T1
  it('/<slug> opens the page: rewritten to the team and matched by the no-language route', async () => {
    const { url, context } = await serve('/about')
    expect(url).toBe('/acme/about')
    const router = publicRouter(context.resolvedDomainTeamSlug, context.resolvedDomainAppSegments, ['en'])
    const r = router.resolve(url)
    // [team]/[...slug].vue renders CroutonPagesPublicPage when the setting is on
    expect(r.name).toBe('team-slug')
    expect(r.params).toEqual({ team: 'acme', slug: ['about'] })

    const nested = await serve('/events/fair')
    expect(router.resolve(nested.url).params).toEqual({ team: 'acme', slug: ['events', 'fair'] })

    const home = await serve('/')
    expect(home.url).toBe('/acme')
    // The home page: same rendering route ([...slug].vue L103-115 renders when
    // the setting is on). vue-router leaves `slug` out for an empty catch-all.
    const homeRoute = router.resolve(home.url)
    expect(homeRoute.name).toBe('team-slug')
    expect(homeRoute.params).toEqual({ team: 'acme' })
  })

  // covers: T1
  it('/en and /en/ forward to / (the language route, home page)', async () => {
    for (const path of ['/en', '/en/']) {
      const { url, context } = await serve(path)
      expect(url).toBe(`/acme${path}`)
      const ctx = await domainContextFor(context)
      const router = publicRouter(ctx.resolvedTeamSlug.value!, ctx.appSegments.value, ['en'])
      const r = router.resolve(url)
      expect(r.name).toBe('team-locale-slug')
      expect(r.params).toEqual({ team: 'acme', locale: 'en' })

      // [team]/[locale]/[...slug].vue's server-side forward; slug is undefined here
      const target = buildPagePath({
        hideTeamInUrl: ctx.hideTeamInLinks.value,
        hideLocaleInUrl: true,
        team: r.params.team as string,
        locale: r.params.locale as string,
        slugPath: ((r.params.slug as string[] | undefined) ?? []).join('/')
      })
      expect(stripTeamPrefix(target, 'acme')).toBe('/')
    }
  })

  // covers: T1
  it('links built on the home page carry neither the team nor the language', async () => {
    const ctx = await domainContextFor((await serve('/')).context)
    const router = publicRouter(ctx.resolvedTeamSlug.value!, ctx.appSegments.value, ['en'])
    const link = (slugPath: string) => buildPagePath({
      hideTeamInUrl: ctx.hideTeamInLinks.value,
      hideLocaleInUrl: ctx.hideLocaleInUrl.value,
      team: 'acme',
      locale: 'en',
      slugPath
    })
    expect(router.resolve(link('about')).href).toBe('/about')
    expect(router.resolve(link('events/fair')).href).toBe('/events/fair')
    expect(router.resolve(link('')).href).toBe('/')
  })

  it('links carry neither the team nor the language', async () => {
    const { context } = await serve('/about')
    const ctx = await domainContextFor(context)
    expect(ctx.isTeamHost.value).toBe(true)
    expect(ctx.hideTeamInLinks.value).toBe(false)
    expect(ctx.hideLocaleInUrl.value).toBe(true)

    const router = publicRouter(ctx.resolvedTeamSlug.value!, ctx.appSegments.value, ['en'])
    const link = (slugPath: string) => buildPagePath({
      hideTeamInUrl: ctx.hideTeamInLinks.value,
      hideLocaleInUrl: ctx.hideLocaleInUrl.value,
      team: 'acme',
      locale: 'en',
      slugPath
    })

    expect(router.resolve(link('about')).href).toBe('/about')
    expect(router.resolve(link('events/fair')).href).toBe('/events/fair')
    expect(router.resolve(link('')).href).toBe('/')

    const binderBase = buildBinderBasePath({
      hideTeamInUrl: ctx.hideTeamInLinks.value,
      hideLocaleInUrl: ctx.hideLocaleInUrl.value,
      team: 'acme',
      locale: 'en',
      slug: 'locations'
    })
    expect(router.resolve(`${binderBase}/item-1`).href).toBe('/locations/item-1')

    // Clicking the link lands on the page route, address bar stays plain
    await router.push(link('about'))
    expect(router.currentRoute.value).toMatchObject({ name: 'team-slug', params: { team: 'acme', slug: ['about'] } })
    expect(router.options.history.location).toBe('/acme/about')
  })

  it('an old address with the language forwards to the plain one, no team in the Location', async () => {
    const { url, context } = await serve('/en/about')
    expect(url).toBe('/acme/en/about')
    const ctx = await domainContextFor(context)
    const router = publicRouter(ctx.resolvedTeamSlug.value!, ctx.appSegments.value, ['en'])
    const r = router.resolve(url)
    expect(r.name).toBe('team-locale-slug')

    // [team]/[locale]/[...slug].vue's server-side forward
    const target = buildPagePath({
      hideTeamInUrl: ctx.hideTeamInLinks.value,
      hideLocaleInUrl: true,
      team: r.params.team as string,
      locale: r.params.locale as string,
      slugPath: (r.params.slug as string[]).join('/')
    })
    expect(stripTeamPrefix(target, ctx.resolvedTeamSlug.value!)).toBe('/about')
  })

  it('setting off: links keep the language, still no team (#4175 unchanged)', async () => {
    pagesConfig.hideLocaleInUrl = false
    const { context } = await serve('/en/about')
    const ctx = await domainContextFor(context)
    expect(ctx.hideLocaleInUrl.value).toBe(false)
    const router = publicRouter(ctx.resolvedTeamSlug.value!, ctx.appSegments.value, ['en', 'fr'])
    const href = router.resolve(buildPagePath({
      hideTeamInUrl: ctx.hideTeamInLinks.value,
      hideLocaleInUrl: ctx.hideLocaleInUrl.value,
      team: 'acme',
      locale: 'en',
      slugPath: 'about'
    })).href
    expect(href).toBe('/en/about')
  })

  // covers: T1
  it('setting off: / still forwards to /en/ (#4175 unchanged)', async () => {
    pagesConfig.hideLocaleInUrl = false // before building the router: publicRouter reads it
    const { url, context } = await serve('/')
    expect(url).toBe('/acme')
    const ctx = await domainContextFor(context)
    expect(ctx.hideLocaleInUrl.value).toBe(false)
    const router = publicRouter(ctx.resolvedTeamSlug.value!, ctx.appSegments.value, ['en', 'fr'])
    const r = router.resolve(url)
    expect(r.name).toBe('team-slug')
    expect(r.params).toEqual({ team: 'acme' })

    // [team]/[...slug].vue L104: `/${team}/${localeCode}/` with an empty slug
    const targetUrl = '/acme/en/'
    expect(stripTeamPrefix(targetUrl, ctx.resolvedTeamSlug.value!)).toBe('/en/')
  })

  // covers: T1
  it("the app's own host is unchanged: /acme and /acme/en → /acme", async () => {
    const { url, context } = await serve('/acme', 'pmcp.dev')
    expect(url).toBe('/acme')
    expect(context.isCustomDomain).toBeUndefined()

    const router = publicRouter('acme', [], ['en'], createMemoryHistory())
    expect(router.resolve('/acme')).toMatchObject({ name: 'team-slug' })
    expect(router.resolve('/acme').params).toEqual({ team: 'acme' })
    const withLang = router.resolve('/acme/en')
    expect(withLang.name).toBe('team-locale-slug')
    expect(withLang.params).toEqual({ team: 'acme', locale: 'en' })

    expect(buildPagePath({
      hideTeamInUrl: false,
      hideLocaleInUrl: true,
      team: 'acme',
      locale: 'en',
      slugPath: ''
    })).toBe('/acme')
  })
})
