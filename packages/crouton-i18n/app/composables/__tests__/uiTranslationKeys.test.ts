import { describe, it, expect, vi } from 'vitest'

import { collectKeys, loadAllLocales, valueAt } from '../uiTranslationKeys'

const compiled = (source: string) => ({ loc: { source }, body: { static: source } })

const messages = {
  en: { bookings: { title: 'Bookings' }, common: { save: 'Save' } },
  fr: { bookings: { title: compiled('Réservations') }, common: { save: 'Enregistrer' }, onlyFr: { hello: 'Bonjour' } },
  nl: { bookings: { title: 'Boekingen' } }
}

describe('uiTranslationKeys', () => {
  it('T1 — same key list and per-language values whether the current language is fr or en', () => {
    // UiList passes ['en', ...configuredLocales]; the configured order differs by current language
    const asFr = collectKeys(messages, ['en', ...['fr', 'nl', 'en']])
    const asEn = collectKeys(messages, ['en', ...['en', 'fr', 'nl']])
    // and even without the English-first prefix the key set is the same
    const rawFr = collectKeys(messages, ['fr', 'nl', 'en'])

    const keySet = (list: { key: string }[]) => new Set(list.map(k => k.key))
    expect(keySet(asFr)).toEqual(keySet(asEn))
    expect(keySet(rawFr)).toEqual(keySet(asEn))
    expect(keySet(asEn)).toEqual(new Set(['bookings.title', 'common.save', 'onlyFr.hello']))

    const byKey = (list: { key: string, value: string }[]) => Object.fromEntries(list.map(k => [k.key, k.value]))
    expect(byKey(asFr)).toEqual(byKey(asEn))
    expect(byKey(asEn)['bookings.title']).toBe('Bookings')

    // per-language values for every key are independent of the current language
    for (const { key } of asEn) {
      const fromFr = ['fr', 'nl', 'en'].map(l => [l, valueAt(messages[l as keyof typeof messages], key)])
      const fromEn = ['en', 'fr', 'nl'].map(l => [l, valueAt(messages[l as keyof typeof messages], key)])
      expect(Object.fromEntries(fromFr)).toEqual(Object.fromEntries(fromEn))
    }
  })

  it('T2 — a key only in French appears with its French value; English has none', () => {
    const keys = collectKeys(messages, ['en', 'fr', 'nl'])
    expect(keys.find(k => k.key === 'onlyFr.hello')).toEqual({ key: 'onlyFr.hello', value: 'Bonjour' })
    expect(valueAt(messages.en, 'onlyFr.hello')).toBeUndefined()
  })

  it('T2b — keys are found even when English messages are not loaded (empty)', () => {
    const keys = collectKeys({ en: {}, fr: messages.fr }, ['en', 'fr'])
    expect(keys.map(k => k.key)).toContain('bookings.title')
    expect(keys.find(k => k.key === 'bookings.title')?.value).toBe('Réservations')
  })

  it('T3 — loadAllLocales calls the loader once per language, waits for all, survives a rejection', async () => {
    const resolved: string[] = []
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const loader = vi.fn((code: string) => new Promise<void>((resolve, reject) => {
      setTimeout(() => {
        if (code === 'nl') return reject(new Error('boom'))
        resolved.push(code)
        resolve()
      }, code === 'en' ? 20 : 5)
    }))

    await expect(loadAllLocales(loader, ['fr', 'nl', 'en'])).resolves.toBeUndefined()

    expect(loader).toHaveBeenCalledTimes(3)
    expect(loader.mock.calls.map(c => c[0])).toEqual(['fr', 'nl', 'en'])
    expect(resolved.sort()).toEqual(['en', 'fr'])
    expect(warn).toHaveBeenCalledTimes(1)
    warn.mockRestore()
  })

  it('T4 — valueAt reads plain strings and compiled messages, undefined for a missing path', () => {
    expect(valueAt(messages.en, 'bookings.title')).toBe('Bookings')
    expect(valueAt(messages.fr, 'bookings.title')).toBe('Réservations')
    expect(valueAt(messages.en, 'bookings.missing')).toBeUndefined()
    expect(valueAt(messages.en, 'nope.deeper.still')).toBeUndefined()
    expect(valueAt(messages.en, 'bookings')).toBeUndefined()
    expect(valueAt(undefined, 'bookings.title')).toBeUndefined()
  })
})
