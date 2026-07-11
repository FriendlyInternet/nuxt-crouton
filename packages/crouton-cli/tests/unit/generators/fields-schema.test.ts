import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { buildFieldsSchema, buildFieldsTypes } from '../../../lib/generate-collection.ts'

// Contract for #1403 — the read/write split:
//
// WRITE path (mode: 'server' — the endpoint body schemas): nullable DB columns
// round-trip `null`, and `null` is how a client clears an optional field, so
// every non-required field must accept null (`.nullish()`). Required fields
// stay omittable-but-never-null (PATCH uses `.partial()`). Bug class first hit
// as commit 5e9dc3ce5 (config), then again as the pages save 400
// (layout/ogImage/robots).
//
// READ path (mode: 'client' — the composable/FormData schema, and the
// generated interfaces): form state binds fields to inputs typed
// `string | undefined`, so null must NOT leak in (regenerating the e2e
// fixtures proved widening these breaks every generated _Form.vue and the
// package components consuming collection types).

const cases = { plural: 'products', pascalCasePlural: 'Products' }

function field(name: string, type: string, meta: Record<string, any> = {}, zod = 'z.string()') {
  return { name, type, meta, zod, default: "''", tsType: 'string' }
}

function build(fields: any[], config: Record<string, any> | null = null, mode?: 'client' | 'server') {
  return buildFieldsSchema({
    fields,
    config,
    hierarchy: { enabled: false } as any,
    cases,
    layerCamelCase: 'shop',
    mode
  })
}

// Compile the emitted schema string into a real zod object, the way the
// generated PATCH endpoint uses it.
function compilePatchSchema(fieldsSchema: string) {
  // eslint-disable-next-line no-new-func
  return new Function('z', `return z.object({ ${fieldsSchema} }).partial().strip()`)(z) as z.ZodType
}

describe('buildFieldsSchema server mode — wire schema accepts null (#1403)', () => {
  it('emits .nullish() for non-required string fields', () => {
    const out = build([
      field('layout', 'string'),
      field('ogImage', 'string'),
      field('robots', 'string')
    ], null, 'server')
    expect(out).toContain('layout: z.string().nullish()')
    expect(out).toContain('ogImage: z.string().nullish()')
    expect(out).toContain('robots: z.string().nullish()')
    expect(out).not.toContain('.optional()')
  })

  it('keeps json and date fields nullish (regression: 5e9dc3ce5 / #196)', () => {
    const out = build([
      field('config', 'json', {}, 'z.record(z.string(), z.any())'),
      field('publishedAt', 'date', {}, 'z.date()')
    ], null, 'server')
    expect(out).toContain('config: z.record(z.string(), z.any()).nullish()')
    expect(out).toContain('publishedAt: z.coerce.date().nullish()')
  })

  it('required fields reject null even under .partial()', () => {
    const schema = compilePatchSchema(build([
      field('name', 'string', { required: true }),
      field('layout', 'string')
    ], null, 'server'))
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
    ], config, 'server')
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
    ], config, 'server'))

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

describe('buildFieldsSchema client mode (default) — FormData never widens to null', () => {
  it('non-required string fields stay .optional()', () => {
    const out = build([field('layout', 'string'), field('ogImage', 'string')])
    expect(out).toContain('layout: z.string().optional()')
    expect(out).toContain('ogImage: z.string().optional()')
    expect(out).not.toContain('layout: z.string().nullish()')
  })

  it('json/date/meta.nullable keep accepting null (pre-existing behavior)', () => {
    const out = build([
      field('config', 'json', {}, 'z.record(z.string(), z.any())'),
      field('publishedAt', 'date', {}, 'z.date()'),
      field('legacy', 'string', { nullable: true })
    ])
    expect(out).toContain('config: z.record(z.string(), z.any()).nullish()')
    expect(out).toContain('publishedAt: z.coerce.date().nullish()')
    expect(out).toContain('legacy: z.string().nullish()')
  })

  it('translatable root fields stay .optional()', () => {
    const config = { translations: { collections: { products: ['title'] } } }
    const out = build([field('title', 'string')], config)
    expect(out).toContain('title: z.string().optional()')
  })
})

describe('buildFieldsSchema server-patch mode — partial-locale translations (#1414)', () => {
  const config = { defaultLocale: 'nl', translations: { collections: { products: ['title', 'slug', 'content'] } } }
  const fieldsT = [
    field('title', 'string', { required: true }),
    field('slug', 'string', { required: true }),
    field('content', 'text'),
    field('layout', 'string')
  ]
  const schema = () => compilePatchSchema(build(fieldsT, config, 'server-patch'))

  it('accepts a partial-locale patch (one field of one locale, no default locale sent)', () => {
    const parsed = schema().parse({ translations: { fr: { content: 'bonjour' } } })
    expect(parsed.translations).toEqual({ fr: { content: 'bonjour' } })
  })

  it('per-locale required fields: absent is fine, empty and null are rejected', () => {
    expect(() => schema().parse({ translations: { nl: { title: '' } } })).toThrow()
    expect(() => schema().parse({ translations: { nl: { title: null } } })).toThrow()
    expect(schema().parse({ translations: { nl: { title: 'ok' } } }).translations.nl.title).toBe('ok')
  })

  it('a null locale entry is accepted (delete-locale semantics)', () => {
    expect(schema().parse({ translations: { fr: null } }).translations.fr).toBeNull()
  })

  it('carries no wire refine — the default-locale invariant is enforced post-merge, not here', () => {
    const out = build(fieldsT, config, 'server-patch')
    expect(out).not.toContain('.refine(')
  })

  it('non-translations fields behave like server mode (nullish)', () => {
    const out = build(fieldsT, config, 'server-patch')
    expect(out).toContain('layout: z.string().nullish()')
  })

  it('server (POST) mode keeps the strict per-locale shape and refine', () => {
    const out = build(fieldsT, config, 'server')
    expect(out).toContain(".min(1, 'Title is required')")
    expect(out).toContain('.refine(')
  })
})

describe('buildFieldsTypes — read interface stays narrow (#1403)', () => {
  function buildTypes(fields: any[], config: Record<string, any> | null = null) {
    return buildFieldsTypes({ fields, config, hierarchy: { enabled: false } as any, cases })
  }

  it('non-required string fields do NOT widen to null (forms/packages bind these)', () => {
    const out = buildTypes([field('layout', 'string'), field('name', 'string', { required: true })])
    expect(out).toContain('layout?: string')
    expect(out).not.toContain('layout?: string | null')
    expect(out).toContain('name: string')
  })

  it('json fields keep | null (their schema is nullish in both modes)', () => {
    const out = buildTypes([field('config', 'json', {}, 'z.record(z.string(), z.any())')])
    expect(out).toContain('config?: string | null')
  })
})
