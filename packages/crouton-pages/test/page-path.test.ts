import { describe, it, expect } from 'vitest'
import { buildPagePath, buildEditorFallbackPath, buildBinderBasePath } from '../app/utils/page-path'

// #4191 — the one-language setting (hideLocaleInUrl).

describe('buildPagePath — hideLocaleInUrl (T1)', () => {
  const base = { hideTeamInUrl: false, team: 'acme', locale: 'en' }

  it('setting on: drops the locale segment', () => {
    expect(buildPagePath({ ...base, hideLocaleInUrl: true, slugPath: 'about' })).toBe('/acme/about')
    expect(buildPagePath({ ...base, hideLocaleInUrl: true, slugPath: '' })).toBe('/acme')
  })

  it('setting on with hideTeamInUrl: /about and home /', () => {
    const opts = { ...base, hideTeamInUrl: true, hideLocaleInUrl: true }
    expect(buildPagePath({ ...opts, slugPath: 'about' })).toBe('/about')
    expect(buildPagePath({ ...opts, slugPath: '' })).toBe('/')
  })

  it('setting on: nested slugs keep their chain', () => {
    expect(buildPagePath({ ...base, hideLocaleInUrl: true, slugPath: 'events/summer-fair' }))
      .toBe('/acme/events/summer-fair')
  })

  it('setting off or undefined: exactly today\'s output', () => {
    for (const hideLocaleInUrl of [false, undefined]) {
      expect(buildPagePath({ ...base, hideLocaleInUrl, slugPath: 'about' })).toBe('/acme/en/about')
      expect(buildPagePath({ ...base, hideLocaleInUrl, slugPath: '' })).toBe('/acme/en')
      expect(buildPagePath({ ...base, hideTeamInUrl: true, hideLocaleInUrl, slugPath: 'about' })).toBe('/en/about')
      expect(buildPagePath({ ...base, hideTeamInUrl: true, hideLocaleInUrl, slugPath: '' })).toBe('/en')
    }
  })
})

describe('hand-built links keep their exact strings (T5)', () => {
  it('editor fallback, setting off: today\'s strings, trailing slash kept for an empty slug', () => {
    expect(buildEditorFallbackPath({ team: 'acme', locale: 'en', slug: 'about' })).toBe('/acme/en/about')
    expect(buildEditorFallbackPath({ team: 'acme', locale: 'en', slug: '', hideLocaleInUrl: false })).toBe('/acme/en/')
  })

  it('editor fallback, setting on: no locale', () => {
    expect(buildEditorFallbackPath({ team: 'acme', locale: 'en', slug: 'about', hideLocaleInUrl: true })).toBe('/acme/about')
    expect(buildEditorFallbackPath({ team: 'acme', locale: 'en', slug: '', hideLocaleInUrl: true })).toBe('/acme')
  })

  it('binder base path, setting off: today\'s strings', () => {
    expect(buildBinderBasePath({ hideTeamInUrl: false, team: 'acme', locale: 'en', slug: 'locations' })).toBe('/acme/en/locations')
    expect(buildBinderBasePath({ hideTeamInUrl: true, hideLocaleInUrl: false, team: 'acme', locale: 'en', slug: 'locations' })).toBe('/en/locations')
  })

  it('binder base path, setting on: no locale', () => {
    expect(buildBinderBasePath({ hideTeamInUrl: false, hideLocaleInUrl: true, team: 'acme', locale: 'en', slug: 'locations' })).toBe('/acme/locations')
    expect(buildBinderBasePath({ hideTeamInUrl: true, hideLocaleInUrl: true, team: 'acme', locale: 'en', slug: 'locations' })).toBe('/locations')
  })
})
