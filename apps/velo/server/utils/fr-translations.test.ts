import { describe, it, expect } from 'vitest'
import { withFrTranslation } from './fr-translations'

describe('withFrTranslation (#2762)', () => {
  const page = { title: 'Welkom', slug: 'welcome', content: '<p>x</p>' }

  it('adds fr from base fields and keeps existing locales', () => {
    const out = withFrTranslation(page, { nl: { title: 'Welkom', slug: 'welcome', content: '<p>x</p>' } })
    expect(out?.nl?.title).toBe('Welkom')
    expect(out?.fr).toEqual({ title: 'Welkom', slug: 'welcome', content: '<p>x</p>' })
  })

  it('handles null translations', () => {
    expect(withFrTranslation(page, null)?.fr?.slug).toBe('welcome')
  })

  it('is idempotent: returns null when fr exists', () => {
    expect(withFrTranslation(page, { fr: { title: 'Bienvenue' } })).toBeNull()
  })
})
