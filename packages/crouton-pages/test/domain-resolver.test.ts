// @vitest-environment node
/**
 * #4175 — the real domain resolver Nitro plugin, end to end, with a stubbed
 * database / request host / runtime config. A verified domain booking.acme.com
 * belongs to team T1 (slug `acme`). The `#crouton-pages/app-segments` virtual
 * module is aliased to test/stubs/app-segments.ts (velo's real list); the
 * build-time list itself is covered by app-segments-build.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@fyit/crouton-auth/server/database/schema/auth', () => ({
  domain: { __table: 'domain', domain: 'domain.domain', organizationId: 'domain.organizationId', status: 'domain.status' },
  organization: { __table: 'organization', id: 'organization.id', slug: 'organization.slug' },
  teamSettings: { __table: 'teamSettings', teamId: 'teamSettings.teamId', siteSettings: 'teamSettings.siteSettings' }
}))
vi.mock('drizzle-orm', () => ({
  eq: (col: unknown, val: unknown) => ({ col, val }),
  and: (...conds: unknown[]) => ({ and: conds })
}))

interface State {
  routingMode: string
  publicSiteEnabled: boolean
  dbCalls: number
}
const state: State = { routingMode: 'team', publicSiteEnabled: true, dbCalls: 0 }

function fakeDB() {
  return {
    select: () => ({
      from: (table: { __table: string }) => {
        state.dbCalls++
        const rows = table.__table === 'domain'
          ? [{ domain: 'booking.acme.com', organizationId: 'T1', status: 'verified' }]
          : table.__table === 'organization'
            ? [{ slug: 'acme' }]
            : [{ siteSettings: { publicSiteEnabled: state.publicSiteEnabled } }]
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

const g = globalThis as Record<string, unknown>
g.defineNitroPlugin = (fn: unknown) => fn
g.defineEventHandler = (fn: unknown) => fn
g.getRequestHost = (event: { host: string }) => event.host
g.useRuntimeConfig = () => ({ public: { croutonPages: { appDomains: ['pmcp.dev'], routingMode: state.routingMode } } })
g.useDB = fakeDB

type Handler = (event: FakeEvent) => Promise<unknown>
interface FakeEvent {
  host: string
  node: { req: { url: string } }
  context: Record<string, unknown>
}

async function setup() {
  const { default: plugin } = await import('../server/plugins/domain-resolver')
  let seen = ''
  const nitroApp = { h3App: { handler: (async (event: FakeEvent) => { seen = event.node.req.url }) as Handler } }
  ;(plugin as unknown as (app: typeof nitroApp) => void)(nitroApp)
  return async (url: string, host = 'booking.acme.com') => {
    const event: FakeEvent = { host, node: { req: { url } }, context: {} }
    await nitroApp.h3App.handler(event)
    return { url: seen, context: event.context }
  }
}

describe('domain resolver (team routing mode)', () => {
  beforeEach(() => {
    state.routingMode = 'team'
    state.publicSiteEnabled = true
    state.dbCalls = 0
  })

  it('cases 1-3: every non-app path gets the team prefix', async () => {
    const run = await setup()
    expect((await run('/about')).url).toBe('/acme/about')
    expect((await run('/en/about')).url).toBe('/acme/en/about')
    expect((await run('/')).url).toBe('/acme')
  })

  it('case 4: an address already prefixed with this team works as-is', async () => {
    const run = await setup()
    expect((await run('/acme/en/about')).url).toBe('/acme/en/about')
  })

  it('case 5: /admin, /auth, /api are untouched with no DB call', async () => {
    const run = await setup()
    for (const p of ['/admin', '/auth/login', '/api/x']) {
      expect((await run(p)).url, p).toBe(p)
    }
    expect(state.dbCalls).toBe(0)
  })

  it('the app pages from the page tree are untouched, with the domain context set', async () => {
    const run = await setup()
    for (const p of ['/account', '/onboarding/create-team']) {
      const { url, context } = await run(p)
      expect(url, p).toBe(p)
      expect(context.isCustomDomain).toBe(true)
      expect(context.resolvedDomainAppSegments).toEqual(['account', 'admin', 'auth', 'onboarding', 'super-admin'])
    }
  })

  it('case 6: the app host is unchanged', async () => {
    const run = await setup()
    const { url, context } = await run('/acme/en/about', 'app.pmcp.dev')
    expect(url).toBe('/acme/en/about')
    expect(context.isCustomDomain).toBeUndefined()
  })

  it('case 7: public site disabled → no rewrite and no context', async () => {
    state.publicSiteEnabled = false
    const run = await setup()
    const { url, context } = await run('/about')
    expect(url).toBe('/about')
    expect(context.isCustomDomain).toBeUndefined()
  })

  it('case 8 input: /old is prefixed and the host team is in the context', async () => {
    const run = await setup()
    const { url, context } = await run('/old')
    expect(url).toBe('/acme/old')
    expect(context.resolvedDomainTeamId).toBe('T1')
    expect(context.resolvedDomainTeamSlug).toBe('acme')
  })
})

describe('domain resolver (locale/custom routing mode: unchanged)', () => {
  for (const mode of ['locale', 'custom']) {
    it(`${mode}: keeps today's rewrite`, async () => {
      state.routingMode = mode
      state.publicSiteEnabled = true
      const run = await setup()
      expect((await run('/about')).url).toBe('/about')
      expect((await run('/en/about')).url).toBe('/en/about')
      expect((await run('/')).url).toBe('/acme')
    })
  }
})
