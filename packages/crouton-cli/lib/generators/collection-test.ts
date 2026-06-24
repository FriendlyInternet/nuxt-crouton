// Generator for a per-collection schema-smoke test (<Collection>.test.ts).
//
// Emitted next to each generated collection (#785/#788). It imports the
// collection's generated Zod schema (from the composable) and asserts the
// deterministic, runtime-free surface: a schema-valid record parses, and an
// invalid one is rejected. This is the unit-level complement to the e2e fixture
// smoke (which owns boot + CRUD) — no Nuxt/DB runtime, no mocks, just zod, so it
// stays green for any schema. On by default; suppressed by `--no-tests`.
//
// The sample is derived at generation time from the same field metadata the
// schema is built from, so it must mirror the schema's required-field rules
// (see fieldsSchema in generate-collection.ts): required string/text uses
// `.min(1)` (so the value must be non-empty), required dependent fields use
// `.min(1)` on an array, dates are `z.coerce.date()` (accept an ISO string),
// and translatable fields are validated under `translations.<defaultLocale>`.

// Auto-generated / system columns and hierarchy columns are injected by the
// runtime, not part of the create/validate schema — never sampled here.
const AUTO_FIELDS = new Set([
  'id', 'teamId', 'owner',
  'createdAt', 'updatedAt', 'createdBy', 'updatedBy',
  'parentId', 'path', 'depth', 'order',
])

function isDependentField(field: Record<string, any>): boolean {
  return Boolean((field.meta?.dependsOn && field.meta?.dependsOnCollection) || field.meta?.displayAs === 'slotButtonGroup')
}

/**
 * A schema-valid literal for a field. Derived from the field's `zod` expression
 * — the same source the generated schema embeds — so the sample matches the
 * schema whether or not the type manifest resolved (a manifest-less run degrades
 * every field to `z.string()`, and so does the sample). Two overrides mirror
 * the schema generator (see fieldsSchema in generate-collection.ts): dates are
 * forced to `z.coerce.date()` (accept an ISO string) and dependent fields to a
 * non-empty `z.array(z.string()).min(1)`.
 */
function sampleLiteral(field: Record<string, any>): string {
  if (isDependentField(field)) return "['sample']"
  if (field.type === 'date') return "'2024-01-01T00:00:00.000Z'"

  const zod = String(field.zod || '')
  // enum (defensive — current generator keeps option fields as z.string())
  const enumMatch = zod.match(/z\.enum\(\[\s*'([^']*)'/)
  if (enumMatch) return `'${enumMatch[1]}'`
  if (/z\.coerce\.date|z\.date/.test(zod)) return "'2024-01-01T00:00:00.000Z'"
  if (/z\.number/.test(zod)) return '1'
  if (/z\.boolean/.test(zod)) return 'true'
  if (/z\.array/.test(zod)) return '[]'
  if (/z\.record|z\.object/.test(zod)) return '{}'
  // strings, text, image/file, option fields, and the manifest-less fallback —
  // required string/text is `.min(1)`, so the value must be non-empty.
  return "'sample'"
}

function objectLiteral(entries: string[], indent = '      '): string {
  if (entries.length === 0) return '{}'
  return `{\n${entries.map(e => `${indent}${e}`).join(',\n')},\n${indent.slice(2)}}`
}

/**
 * Generate the source of a `<Collection>.test.ts` schema-smoke test.
 * Returns the file content as a string (the orchestrator decides whether to
 * write it, honouring `--no-tests`).
 */
export function generateCollectionTest(data: Record<string, any>, config: Record<string, any> | null = null): string {
  const { layer, plural, pascalCase, pascalCasePlural, layerPascalCase, layerCamelCase, fields } = data

  const schemaName = `${layerCamelCase}${pascalCase}Schema`
  const composableName = `use${layerPascalCase}${pascalCasePlural}`
  const importPath = `./app/composables/${composableName}`

  // Translatable fields are validated under `translations` (config-driven, mirrors fieldsSchema).
  const translatableFieldNames: string[] = config?.translations?.collections?.[plural] || []
  const defaultLocale: string = config?.defaultLocale || 'en'

  const schemaFields = fields.filter((f: Record<string, any>) => !AUTO_FIELDS.has(f.name))
  const plainFields = schemaFields.filter((f: Record<string, any>) => !translatableFieldNames.includes(f.name))
  const requiredPlain = plainFields.filter((f: Record<string, any>) => f.meta?.required)
  const translatableFields = schemaFields.filter((f: Record<string, any>) => translatableFieldNames.includes(f.name))
  const requiredTranslatable = translatableFields.filter((f: Record<string, any>) => f.meta?.required)

  // Build the valid sample: every required plain field with a type-correct value
  // (optional fields are omitted — they're `.optional()`/`.nullish()`).
  const validEntries: string[] = requiredPlain.map((f: Record<string, any>) => `${f.name}: ${sampleLiteral(f)}`)

  // When the schema has translatable fields it carries a (required) `translations`
  // record; populate the default locale for any required translatable fields.
  if (translatableFieldNames.length > 0) {
    if (requiredTranslatable.length > 0) {
      const inner = requiredTranslatable.map((f: Record<string, any>) => `${f.name}: 'sample'`).join(', ')
      validEntries.push(`translations: { ${defaultLocale}: { ${inner} } }`)
    } else {
      validEntries.push('translations: {}')
    }
  }

  const validLiteral = objectLiteral(validEntries)

  // Build the invalid sample so there's always a meaningful red case:
  //  - omit a required plain field (most common), else
  //  - blank the required translations, else
  //  - assert a non-object is rejected (collection has no required fields).
  let invalidBody: string
  if (requiredPlain.length > 0) {
    const omit = requiredPlain[0].name
    const invalidEntries = validEntries.filter(e => !e.startsWith(`${omit}:`))
    invalidBody = `    const invalid = ${objectLiteral(invalidEntries)}\n    expect(${schemaName}.safeParse(invalid).success).toBe(false)`
  } else if (requiredTranslatable.length > 0) {
    const invalidEntries = validEntries.map(e => e.startsWith('translations:') ? 'translations: {}' : e)
    invalidBody = `    const invalid = ${objectLiteral(invalidEntries)}\n    expect(${schemaName}.safeParse(invalid).success).toBe(false)`
  } else {
    invalidBody = `    // no required fields — a non-object must still be rejected\n    expect(${schemaName}.safeParse(null).success).toBe(false)`
  }

  const header = `/**
 * @crouton-generated
 * @collection ${plural}
 * @layer ${layer}
 *
 * Schema-smoke test (#785): asserts the generated Zod schema accepts a valid
 * record and rejects an invalid one. Runtime-free (zod only) — the e2e fixture
 * smoke owns boot + CRUD. Regenerate with --force; suppress with --no-tests.
 */
`

  return `${header}import { describe, it, expect } from 'vitest'
import { ${schemaName} } from '${importPath}'

describe('${layer}/${plural} schema (generated)', () => {
  it('accepts a valid record', () => {
    const valid = ${validLiteral}
    expect(${schemaName}.safeParse(valid).success).toBe(true)
  })

  it('rejects an invalid record', () => {
${invalidBody}
  })
})
`
}
