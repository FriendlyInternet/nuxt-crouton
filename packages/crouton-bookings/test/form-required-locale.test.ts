/**
 * #4236 — the standard location and email-template forms require the app's
 * default language (same rule as the translation input), not always English.
 * The default export is what the form calls in setup, passing its `useI18n()`
 * result; here that result is a plain object.
 */
import { describe, it, expect } from 'vitest'
import useBookingsLocationsForm, { bookingsLocationSchema, bookingsLocationSchemaFor } from '../collections/locations/app/composables/useBookingsLocations'
import useBookingsEmailtemplatesForm, { bookingsEmailtemplateSchema, bookingsEmailtemplateSchemaFor } from '../collections/emailtemplates/app/composables/useBookingsEmailtemplates'

const frLocation = { title: 'Location de kayaks', translations: { fr: { title: 'Location de kayaks' } } }
const enLocation = { title: 'Kayak Rental', translations: { en: { title: 'Kayak Rental' } } }

const templateBase = { fromEmail: 'a@b.c', triggerType: 'booking_created', recipientType: 'customer' }
const frTemplate = { ...templateBase, translations: { fr: { name: 'Confirmation', subject: 'Sujet', body: 'Corps' } } }
const enTemplate = { ...templateBase, translations: { en: { name: 'Confirmation', subject: 'Subject', body: 'Body' } } }

const messages = (r: { success: boolean, error?: { issues: { message: string }[] } }) => (r.error?.issues ?? []).map(i => i.message).join(' | ')


describe('location form schema per language (#4236)', () => {
  it('fr: accepts fr-only and refuses en-only, naming the language', () => {
    expect(bookingsLocationSchemaFor('fr').safeParse(frLocation).success).toBe(true)
    const r = bookingsLocationSchemaFor('fr').safeParse(enLocation)
    expect(r.success).toBe(false)
    expect(messages(r as any)).toContain('(fr)')
  })

  it('en: accepts en-only and refuses fr-only; the old export is the en schema', () => {
    expect(bookingsLocationSchemaFor('en').safeParse(enLocation).success).toBe(true)
    expect(bookingsLocationSchemaFor('en').safeParse(frLocation).success).toBe(false)
    expect(bookingsLocationSchema.safeParse(enLocation).success).toBe(true)
    expect(bookingsLocationSchema.safeParse(frLocation).success).toBe(false)
  })

  it('the form object in a fr-default app accepts fr-only', () => {
    const { schema } = useBookingsLocationsForm({ locales: { value: [{ code: 'fr' }, { code: 'nl' }, { code: 'en' }] }, defaultLocale: 'fr' })
    expect(schema.safeParse(frLocation).success).toBe(true)
    expect(schema.safeParse(enLocation).success).toBe(false)
  })
})

describe('email-template form schema per language (#4236)', () => {
  it('fr: accepts fr-only and refuses en-only, naming the language', () => {
    expect(bookingsEmailtemplateSchemaFor('fr').safeParse(frTemplate).success).toBe(true)
    const r = bookingsEmailtemplateSchemaFor('fr').safeParse(enTemplate)
    expect(r.success).toBe(false)
    expect(messages(r as any)).toContain('name, subject, body (fr)')
  })

  it('en: accepts en-only and refuses fr-only; the old export is the en schema', () => {
    expect(bookingsEmailtemplateSchemaFor('en').safeParse(enTemplate).success).toBe(true)
    expect(bookingsEmailtemplateSchemaFor('en').safeParse(frTemplate).success).toBe(false)
    expect(bookingsEmailtemplateSchema.safeParse(enTemplate).success).toBe(true)
  })

  it('the form object in a fr-default app accepts fr-only', () => {
    const { schema } = useBookingsEmailtemplatesForm({ locales: { value: ['fr', 'nl', 'en'] }, defaultLocale: 'fr' })
    expect(schema.safeParse(frTemplate).success).toBe(true)
    expect(schema.safeParse(enTemplate).success).toBe(false)
  })
})
