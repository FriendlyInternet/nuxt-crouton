import { describe, it, expect } from 'vitest'
import { buildSeoUrl, publicTeamSegment } from '../app/utils/page-path'

// #4293 — SEO links (canonical, og:url, hreflang) use the public address, i.e.
// the team slug, never the signed-in visitor's team id.

describe('publicTeamSegment (T1)', () => {
  it('prefers the route slug over the team id', () => {
    expect(publicTeamSegment({ routeTeam: 'test1', teamSlug: 'test1', teamId: 'e5aaecdf-1234' })).toBe('test1')
    expect(publicTeamSegment({ routeTeam: 'test1', teamSlug: null, teamId: 'seed:org:test1' })).toBe('test1')
  })

  it('falls back to the slug, then the id, then null', () => {
    expect(publicTeamSegment({ routeTeam: null, teamSlug: 'acme', teamId: 'id-1' })).toBe('acme')
    expect(publicTeamSegment({ routeTeam: '', teamSlug: '', teamId: 'id-1' })).toBe('id-1')
    expect(publicTeamSegment({})).toBeNull()
  })
})

describe('buildSeoUrl', () => {
  const team = { hideTeamInUrl: false, team: 'test1', locale: 'en' }

  it('S1: team mode → /<team>/<locale>/<slug> (T2)', () => {
    expect(buildSeoUrl({ ...team, path: 'about' })).toBe('/test1/en/about')
    expect(buildSeoUrl({ ...team, siteUrl: 'https://x.dev', path: 'about' })).toBe('https://x.dev/test1/en/about')
    expect(buildSeoUrl({ ...team, path: '' })).toBe('/test1/en')
  })

  it('S2: team mode + hideLocaleInUrl → /<team>/<slug> (T3)', () => {
    expect(buildSeoUrl({ ...team, hideLocaleInUrl: true, path: 'about' })).toBe('/test1/about')
    expect(buildSeoUrl({ ...team, hideLocaleInUrl: true, path: '' })).toBe('/test1')
  })

  it('S3: connected domain (hideTeamInUrl) → /<locale>/<slug> or /<slug> (T4)', () => {
    const domain = { ...team, hideTeamInUrl: true }
    expect(buildSeoUrl({ ...domain, path: 'about' })).toBe('/en/about')
    expect(buildSeoUrl({ ...domain, hideLocaleInUrl: true, path: 'about' })).toBe('/about')
    expect(buildSeoUrl({ ...domain, hideLocaleInUrl: true, path: '' })).toBe('/')
    expect(buildSeoUrl({ ...domain, hideLocaleInUrl: true, siteUrl: 'https://x.dev', path: '' })).toBe('https://x.dev')
  })

  it('S4: hreflang follows the same rules for each locale (T5)', () => {
    const slugs: Record<string, string> = { en: 'about', fr: 'a-propos', nl: 'over' }
    const hrefs = (hideLocaleInUrl: boolean) => Object.entries(slugs).map(([locale, path]) =>
      buildSeoUrl({ hideTeamInUrl: false, hideLocaleInUrl, team: 'test1', locale, path }))
    expect(hrefs(false)).toEqual(['/test1/en/about', '/test1/fr/a-propos', '/test1/nl/over'])
    expect(hrefs(true)).toEqual(['/test1/about', '/test1/a-propos', '/test1/over'])
  })
})
