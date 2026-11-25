/**
 * #4236 — the forms copy every translated field of the app's default language
 * into the main columns, because readers (lists, cards, emails) fall back to them.
 */
import { describe, it, expect } from 'vitest'
import { applyDefaultLocaleEmailtemplateFields } from '../collections/emailtemplates/app/utils/applyDefaultLocaleEmailtemplateFields'
import { applyDefaultLocaleLocationFields } from '../collections/locations/app/utils/applyDefaultLocaleLocationFields'
import { resolveTranslatedField } from '../server/utils/booking-emails'

describe('applyDefaultLocaleEmailtemplateFields', () => {
  it('copies name, subject and body into the main columns', () => {
    const state: Record<string, any> = { name: '', subject: '', body: '' }
    applyDefaultLocaleEmailtemplateFields(state, { field: 'name', value: 'Confirmation' })
    applyDefaultLocaleEmailtemplateFields(state, { field: 'subject', value: 'Sujet' })
    applyDefaultLocaleEmailtemplateFields(state, { field: 'body', value: 'Corps' })
    expect(state).toEqual({ name: 'Confirmation', subject: 'Sujet', body: 'Corps' })
  })

  it('ignores a field it does not know', () => {
    const state: Record<string, any> = { name: 'N' }
    applyDefaultLocaleEmailtemplateFields(state, { field: 'other', value: 'x' })
    expect(state).toEqual({ name: 'N' })
  })

  it('a fr-only template built through the form still sends a non-empty subject and body to an en customer', () => {
    const state: Record<string, any> = { name: '', subject: '', body: '', translations: {} }
    for (const [field, value] of Object.entries({ name: 'Confirmation', subject: 'Sujet', body: 'Corps' })) {
      state.translations.fr = { ...state.translations.fr, [field]: value }
      applyDefaultLocaleEmailtemplateFields(state, { field, value })
    }
    expect(resolveTranslatedField(state.subject, state.translations, 'subject', 'en')).toBe('Sujet')
    expect(resolveTranslatedField(state.body, state.translations, 'body', 'en')).toBe('Corps')
  })
})

describe('applyDefaultLocaleLocationFields', () => {
  it('copies title and content into the main columns', () => {
    const state: Record<string, any> = { title: '', content: '' }
    applyDefaultLocaleLocationFields(state, { field: 'title', value: 'Location de kayaks' })
    applyDefaultLocaleLocationFields(state, { field: 'content', value: 'Au bord du lac' })
    expect(state).toEqual({ title: 'Location de kayaks', content: 'Au bord du lac' })
  })

  it('leaves other fields alone', () => {
    const state: Record<string, any> = { title: 'T', city: 'Lyon' }
    applyDefaultLocaleLocationFields(state, { field: 'city', value: 'Paris' })
    expect(state).toEqual({ title: 'T', city: 'Lyon' })
  })
})
