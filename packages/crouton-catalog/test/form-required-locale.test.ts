/**
 * #4236 — the product form requires the app's default language (same rule as
 * the translation input), not always English; the seed writes that language.
 */
import { describe, it, expect } from 'vitest'
import Database from 'better-sqlite3'
import { collectSeedSql } from '@fyit/crouton-core/shared/seed'
import useCatalogProductsForm, { catalogProductSchema, catalogProductSchemaFor } from '../collections/products/app/composables/useCatalogProducts'
import { localeCodes, requiredLocale } from '../required-locale'
import { provider as catalogProvider } from '../seed'


const fr = { title: 'Vélo', translations: { fr: { title: 'Vélo' } } }
const en = { title: 'Bike', translations: { en: { title: 'Bike' } } }

describe('requiredLocale', () => {
  it('picks defaultLocale when configured, else the first locale, else en', () => {
    expect(requiredLocale(['fr', 'nl', 'en'], 'fr')).toBe('fr')
    expect(requiredLocale(['nl'], 'en')).toBe('nl')
    expect(requiredLocale([], undefined)).toBe('en')
    expect(requiredLocale([], 'de')).toBe('de')
  })

  it('localeCodes reads strings and { code } objects', () => {
    expect(localeCodes(['fr', { code: 'nl' }])).toEqual(['fr', 'nl'])
    expect(localeCodes(undefined)).toEqual([])
  })
})

describe('product form schema per language', () => {
  it('fr: accepts fr-only and refuses en-only, naming the language', () => {
    expect(catalogProductSchemaFor('fr').safeParse(fr).success).toBe(true)
    const r = catalogProductSchemaFor('fr').safeParse(en)
    expect(r.success).toBe(false)
    expect(r.error!.issues.map(i => i.message).join(' | ')).toContain('(fr)')
  })

  it('en: accepts en-only and refuses fr-only; the old export is the en schema', () => {
    expect(catalogProductSchemaFor('en').safeParse(en).success).toBe(true)
    expect(catalogProductSchemaFor('en').safeParse(fr).success).toBe(false)
    expect(catalogProductSchema.safeParse(en).success).toBe(true)
    expect(catalogProductSchema.safeParse(fr).success).toBe(false)
  })

  it('the form object in a fr-default app accepts fr-only', () => {
    const { schema } = useCatalogProductsForm({ locales: { value: [{ code: 'fr' }, { code: 'nl' }, { code: 'en' }] }, defaultLocale: { value: 'fr' } })
    expect(schema.safeParse(fr).success).toBe(true)
    expect(schema.safeParse(en).success).toBe(false)
  })
})

describe('catalog seed language', () => {
  it('a fr app seeds fr + nl translations and no en', async () => {
    const client = new Database(':memory:')
    client.exec('CREATE TABLE catalog_products (id text primary key, teamId text not null, owner text not null, "order" integer not null, title text not null, description text, active integer, translations text, createdAt integer not null, updatedAt integer not null, createdBy text not null, updatedBy text not null);')
    const sql = await collectSeedSql({ providers: [catalogProvider], teamSlug: 'acme', teamId: 't1', locale: 'fr' })
    for (const statement of sql.split('\n').map(s => s.trim()).filter(Boolean)) client.exec(statement)
    const rows = client.prepare('select title, translations from catalog_products').all() as { title: string, translations: string }[]
    expect(rows.length).toBe(4)
    for (const row of rows) {
      const t = JSON.parse(row.translations)
      expect(Object.keys(t).sort()).toEqual(['fr', 'nl'])
      expect(t.fr.title).toBe(row.title)
    }
    client.close()
  })
})
