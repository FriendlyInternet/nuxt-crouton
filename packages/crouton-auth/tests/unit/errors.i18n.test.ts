import { describe, it, expect } from 'vitest'
import en from '../../i18n/locales/en.json'
import nl from '../../i18n/locales/nl.json'
import fr from '../../i18n/locales/fr.json'
import {
  AUTH_ERROR_CODES,
  AuthError,
  DEFAULT_ERROR_MESSAGES,
  errorMessageKey,
  authErrorFromResponse,
  localizeError,
  translateErrorCode,
  withErrorHandling
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

describe('authErrorFromResponse', () => {
  const res = (status: number, body?: unknown) =>
    new Response(body === undefined ? 'not json' : JSON.stringify(body), { status })

  it('uses a known code and message from the body', async () => {
    const err = await authErrorFromResponse(res(400, { code: AUTH_ERROR_CODES.TEAM_NOT_FOUND, message: 'gone', details: { id: 1 } }))
    expect(err.code).toBe(AUTH_ERROR_CODES.TEAM_NOT_FOUND)
    expect(err.message).toBe('gone')
  })

  it.each([
    [401, AUTH_ERROR_CODES.AUTH_UNAUTHORIZED],
    [403, AUTH_ERROR_CODES.AUTH_FORBIDDEN],
    [404, AUTH_ERROR_CODES.AUTH_USER_NOT_FOUND],
    [429, AUTH_ERROR_CODES.AUTH_RATE_LIMITED],
    [500, AUTH_ERROR_CODES.SERVER_ERROR],
    [418, AUTH_ERROR_CODES.UNKNOWN_ERROR]
  ])('maps status %i to a code when the body has none', async (status, code) => {
    expect((await authErrorFromResponse(res(status))).code).toBe(code)
  })
})

describe('withErrorHandling', () => {
  it('passes results through', async () => {
    expect(await withErrorHandling(async () => 'ok')()).toBe('ok')
  })

  it('wraps, reports and rethrows by default', async () => {
    const seen: unknown[] = []
    const fn = withErrorHandling(async () => { throw new Error('network down') }, { onError: e => seen.push(e) })
    await expect(fn()).rejects.toMatchObject({ code: AUTH_ERROR_CODES.NETWORK_ERROR })
    expect(seen).toHaveLength(1)
  })

  it('swallows when rethrow is false and keeps existing AuthErrors', async () => {
    const original = new AuthError(AUTH_ERROR_CODES.AUTH_FORBIDDEN)
    const seen: unknown[] = []
    const fn = withErrorHandling(async () => { throw original }, { rethrow: false, onError: e => seen.push(e) })
    expect(await fn()).toBeUndefined()
    expect(seen[0]).toBe(original)
  })
})
