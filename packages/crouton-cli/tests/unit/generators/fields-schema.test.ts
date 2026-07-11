import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { buildFieldsSchema, buildFieldsTypes } from '../../../lib/generate-collection.ts'

// Contract for #1403: nullable DB columns round-trip `null`, so the generated
// body schemas must accept `null` for every non-required field (`.nullish()`),
// while required fields stay omittable-but-never-null (PATCH uses `.partial()`).
// Bug class first hit as commit 5e9dc3ce5 (config), then again as the pages
// save 400 (layout/ogImage/robots).

const cases = { plural: 'products', pascalCasePlural: 'Products' }

function field(name: string, type: string, meta: Record<string, any> = {}, zod = 'z.string()') {
  return { name, type, meta, zod, default: "''", tsType: 'string' }
}

function build(fields: any[], config: Record<string, any> | null = null) {
  return buildFieldsSchema({
    fields,
    config,
    hierarchy: { enabled: false } as any,
    cases,
    layerCamelCase: 'shop'
  })
}

// Compile the emitted schema string into a real zod object, the way the
// generated PATCH endpoint uses it.
function compilePatchSchema(fieldsSchema: string) {
  // eslint-disable-next-line no-new-func
  return new Function('z', `return z.object({ ${fieldsSchema} }).partial().strip()`)(z) as z.ZodType
}

describe('buildFieldsSchema — null handling (#1403)', () => {
  it('emits .nullish() for non-required string fields', () => {
    const out = build([
      field('layout', 'string'),
      field('ogImage', 'string'),
      field('robots', 'string')
    ])
    expect(out).toContain('layout: z.string().nullish()')
    expect(out).toContain('ogImage: z.string().nullish()')
    expect(out).toContain('robots: z.string().nullish()')
    expect(out).not.toContain('.optional()')
  })

  it('keeps json and date fields nullish (regression: 5e9dc3ce5 / #196)', () => {
    const out = build([
      field('config', 'json', {}, 'z.record(z.string(), z.any())'),
      field('publishedAt', 'date', {}, 'z.date()')
    ])
    expect(out).toContain('config: z.record(z.string(), z.any()).nullish()')
    expect(out).toContain('publishedAt: z.coerce.date().nullish()')
  })

  it('required fields reject null even under .partial()', () => {
    const schema = compilePatchSchema(build([
      field('name', 'string', { required: true }),
      field('layout', 'string')
    ]))
    expect(() => schema.parse({ name: null })).toThrow()
    expect(schema.parse({})).toEqual({})
    expect(schema.parse({ name: 'ok' })).toEqual({ name: 'ok' })
  })

  it('emits .nullish() for translatable root fields', () => {
    const config = { translations: { collections: { products: ['title', 'seoTitle'] } } }
    const out = build([
      field('title', 'string'),
      field('seoTitle', 'string'),
      field('layout', 'string')
    ], config)
    expect(out).toContain('title: z.string().nullish()')
    expect(out).toContain('seoTitle: z.string().nullish()')
  })

  it('accepts the real-world round-trip payload: a loaded record PATCHed back with null columns', () => {
    const config = { defaultLocale: 'nl', translations: { collections: { products: ['title', 'slug'] } } }
    const schema = compilePatchSchema(build([
      field('title', 'string', { required: true }),
      field('slug', 'string', { required: true }),
      field('pageType', 'string', { required: true }),
      field('content', 'text'),
      field('layout', 'string'),
      field('ogImage', 'string'),
      field('robots', 'string'),
      field('config', 'json', {}, 'z.record(z.string(), z.any())'),
      field('publishedAt', 'date', {}, 'z.date()')
    ], config))

    // The exact shape that 400'd: nullable columns echoed back as null,
    // plus unknown record keys the server must strip, not reject.
    const parsed = schema.parse({
      id: 'seed:page:test1:vlaamsekermis',
      teamId: 'seed:org:test1',
      title: 'Vlaamse Kermis',
      slug: 'vlaamsekermis',
      pageType: 'pages:regular',
      content: '{"type":"doc"}',
      config: null,
      layout: null,
      ogImage: null,
      robots: null,
      publishedAt: '2026-07-09T19:23:53.000Z',
      translations: { nl: { title: 'Vlaamse Kermis', slug: 'vlaamsekermis' } }
    })
    expect(parsed.layout).toBeNull()
    expect(parsed.ogImage).toBeNull()
    expect(parsed).not.toHaveProperty('id')
    expect(parsed).not.toHaveProperty('teamId')

    // null is also how a client legitimately CLEARS an optional field.
    expect(schema.parse({ ogImage: null })).toEqual({ ogImage: null })
  })
})

describe('buildFieldsTypes — interfaces mirror the nullish schema (#1403)', () => {
  function buildTypes(fields: any[], config: Record<string, any> | null = null) {
    return buildFieldsTypes({ fields, config, hierarchy: { enabled: false } as any, cases })
  }

  it('non-required fields are optional AND nullable', () => {
    const out = buildTypes([field('layout', 'string'), field('name', 'string', { required: true })])
    expect(out).toContain('layout?: string | null')
    expect(out).toContain('name: string')
    expect(out).not.toContain('name: string | null')
  })

  it('translatable root fields are optional and nullable even when required per-locale', () => {
    const config = { translations: { collections: { products: ['title'] } } }
    const out = buildTypes([field('title', 'string', { required: true })], config)
    expect(out).toContain('title?: string | null')
  })
})
