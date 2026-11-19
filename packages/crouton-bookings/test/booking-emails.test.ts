import { describe, it, expect } from 'vitest'
import { resolveTranslatedField } from '../server/utils/booking-emails'

// E1 (#4244): customer language → app default language → main field → any other language
describe('resolveTranslatedField fallback order', () => {
  it('falls back to the only translation when the main field is empty (default fr)', () => {
    expect(resolveTranslatedField('', { fr: { subject: 'Bonjour' } }, 'subject', 'en', 'fr')).toBe('Bonjour')
  })

  it('falls back to any other language when neither the customer nor default language has text', () => {
    expect(resolveTranslatedField('', { fr: { subject: 'Bonjour' } }, 'subject', 'en', 'en')).toBe('Bonjour')
    expect(resolveTranslatedField('', { fr: { subject: 'Bonjour' } }, 'subject', 'en')).toBe('Bonjour')
  })

  it('prefers the customer language, then the default, then the main field', () => {
    const tr = { fr: { subject: 'Bonjour' }, nl: { subject: 'Hallo' } }
    expect(resolveTranslatedField('Main', tr, 'subject', 'nl', 'fr')).toBe('Hallo')
    expect(resolveTranslatedField('Main', tr, 'subject', 'en', 'fr')).toBe('Bonjour')
    expect(resolveTranslatedField('Main', { nl: { subject: 'Hallo' } }, 'subject', 'en', 'fr')).toBe('Main')
  })

  it('treats whitespace-only text as empty', () => {
    expect(resolveTranslatedField('x', { en: { subject: '  ' } }, 'subject', 'en')).toBe('x')
    expect(resolveTranslatedField('  ', { en: { subject: ' ' }, fr: { subject: 'Bonjour' } }, 'subject', 'en', 'en')).toBe('Bonjour')
    expect(resolveTranslatedField('  ', null, 'subject', 'en')).toBe('')
  })
})
