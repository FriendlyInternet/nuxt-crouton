import { describe, it, expect } from 'vitest'
import { appPageSegments } from '../app-page-segments'
import {
  isAppOwnedSegment,
  localeLessTarget,
  rewriteForTeamHost,
  stripTeamPrefix
} from '../app/utils/custom-domain-path'

// #4175 — the path rules for a connected domain (team routing mode)
const APP = appPageSegments([
  { path: '/account' },
  { path: '/onboarding/create-team' },
  { path: '/admin/:team()' },
  { path: '/:team()/:locale()/:slug(.*)*' },
  { path: '/' },
  { path: '/__review' }
])

describe('appPageSegments', () => {
  it('keeps the first non-param segment of each top-level page, sorted and de-duplicated', () => {
    expect(APP).toEqual(['__review', 'account', 'admin', 'onboarding'])
  })
})

describe('rewriteForTeamHost', () => {
  it('case 1: prefixes a page without a language', () => {
    expect(rewriteForTeamHost('/about', 'acme', APP)).toBe('/acme/about')
  })
  it('case 2: prefixes a page with a language', () => {
    expect(rewriteForTeamHost('/en/about', 'acme', APP)).toBe('/acme/en/about')
  })
  it('case 3: the home page, and the query string is kept', () => {
    expect(rewriteForTeamHost('/', 'acme', APP)).toBe('/acme')
    expect(rewriteForTeamHost('/?x=1', 'acme', APP)).toBe('/acme?x=1')
    expect(rewriteForTeamHost('/about?x=1', 'acme', APP)).toBe('/acme/about?x=1')
  })
  it('case 4: an address already prefixed with this team is left alone', () => {
    expect(rewriteForTeamHost('/acme/en/about', 'acme', APP)).toBeNull()
  })
  it('case 5: app-owned and internal addresses are left alone', () => {
    for (const p of ['/admin', '/admin/x', '/auth/login', '/api/x', '/__nuxt_island/x', '/favicon.ico']) {
      expect(rewriteForTeamHost(p, 'acme', APP), p).toBeNull()
    }
  })
  it("another team's slug is read as a page slug of this team", () => {
    expect(rewriteForTeamHost('/otherteam/en/x', 'acme', APP)).toBe('/acme/otherteam/en/x')
  })
  it('the app pages from the page tree are left alone', () => {
    expect(rewriteForTeamHost('/account', 'acme', APP)).toBeNull()
    expect(rewriteForTeamHost('/account?tab=1', 'acme', APP)).toBeNull()
    expect(rewriteForTeamHost('/onboarding/create-team', 'acme', APP)).toBeNull()
  })
  it('a page an app adds at the top level is left alone', () => {
    expect(rewriteForTeamHost('/kvr/x', 'acme', ['kvr'])).toBeNull()
    expect(rewriteForTeamHost('/about', 'acme', ['kvr'])).toBe('/acme/about')
  })
})

describe('isAppOwnedSegment', () => {
  it('has no hand-kept page names', () => {
    expect(isAppOwnedSegment('super-admin', [])).toBe(false)
    expect(isAppOwnedSegment('api', [])).toBe(true)
    expect(isAppOwnedSegment('_ipx', [])).toBe(true)
  })
})

describe('stripTeamPrefix', () => {
  it('strips only this team prefix', () => {
    expect(stripTeamPrefix('/acme', 'acme')).toBe('/')
    expect(stripTeamPrefix('/acme/fr/x?y=1', 'acme')).toBe('/fr/x?y=1')
    expect(stripTeamPrefix('/acme?q=1', 'acme')).toBe('/?q=1')
    expect(stripTeamPrefix('/acme#h', 'acme')).toBe('/#h')
    expect(stripTeamPrefix('/admin/acme', 'acme')).toBe('/admin/acme')
    expect(stripTeamPrefix('/acmex', 'acme')).toBe('/acmex')
    expect(stripTeamPrefix('/fr/x', 'acme')).toBe('/fr/x')
  })
})

describe('localeLessTarget', () => {
  it('forwards an address without a language to the default locale', () => {
    expect(localeLessTarget('acme', 'about', '', 'fr')).toBe('/acme/fr/about')
    expect(stripTeamPrefix(localeLessTarget('acme', 'about', '', 'fr'), 'acme')).toBe('/fr/about')
    expect(localeLessTarget('acme', 'events', 'summer', 'en')).toBe('/acme/en/events/summer')
  })
})
