import { describe, it, expect } from 'vitest'
import en from '../../i18n/locales/en.json'
import nl from '../../i18n/locales/nl.json'
import fr from '../../i18n/locales/fr.json'
import {
  AUTH_ERROR_CODES,
  AuthError,
  DEFAULT_ERROR_MESSAGES,
  errorMessageKey,
  localizeError,
  translateErrorCode
} from '../../app/utils/errors'

const lookup = (src: unknown, key: string) =>
  key.split('.').reduce<any>((node, part) => node?.[part], src)

const codes = Object.values(AUTH_ERROR_CODES)

describe('error code -> locale key mapping', () => {
  it('maps a code to errors.<code>', () => {
    expect(errorMessageKey(AUTH_ERROR_CODES.AUTH_INVALID_CREDENTIALS)).toBe('errors.auth.invalid_credentials')
  })

  it.each([['en', en], ['nl', nl], ['fr', fr]])('%s has a string for every code', (_n, locale) => {
    for (const code of codes) {
      expect(typeof lookup(locale, errorMessageKey(code)), code).toBe('string')
    }
  })

  it('en matches the built-in English defaults', () => {
    for (const code of codes) {
      expect(lookup(en, errorMessageKey(code))).toBe(DEFAULT_ERROR_MESSAGES[code])
    }
  })

  it('translates via the supplied t', () => {
    const t = (k: string) => lookup(fr, k) ?? k
    expect(translateErrorCode(AUTH_ERROR_CODES.TEAM_NOT_FOUND, t)).toBe('Équipe introuvable')
  })

  it('falls back to English when the key is missing', () => {
    expect(translateErrorCode(AUTH_ERROR_CODES.TEAM_NOT_FOUND, k => k)).toBe('Team not found')
  })

  it('keeps custom (server) messages, translates default ones', () => {
    const t = (k: string) => lookup(nl, k) ?? k
    expect(localizeError(new AuthError(AUTH_ERROR_CODES.AUTH_RATE_LIMITED), t)).toBe('Te veel pogingen. Probeer het later opnieuw.')
    expect(localizeError(new AuthError(AUTH_ERROR_CODES.AUTH_RATE_LIMITED, 'Slow down'), t)).toBe('Slow down')
  })
})
