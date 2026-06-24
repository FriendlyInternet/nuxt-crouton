import { describe, it, expect } from 'vitest'
import { generateCollectionTest } from '../../../lib/generators/collection-test.ts'

// Minimal `data` shape the orchestrator passes to generators (see generate-collection.ts).
const baseData = {
  layer: 'shop',
  singular: 'product',
  plural: 'products',
  pascalCase: 'Product',
  pascalCasePlural: 'Products',
  layerPascalCase: 'Shop',
  layerCamelCase: 'shop',
  // `zod`/`default`/`tsType` are what loadFields attaches once the type manifest
  // resolves — the sample is derived from `zod`, so the fixtures carry it.
  fields: [
    { name: 'id', type: 'string', zod: 'z.string()', meta: { primaryKey: true } },
    { name: 'name', type: 'string', zod: 'z.string()', meta: { required: true } },
    { name: 'price', type: 'decimal', zod: 'z.number()', meta: { required: true } },
    { name: 'inStock', type: 'boolean', zod: 'z.boolean()', meta: {} },
    { name: 'releasedAt', type: 'date', zod: 'z.date()', meta: {} },
  ],
}

describe('generateCollectionTest (#788)', () => {
  const code = generateCollectionTest(baseData, null)

  it('imports the generated Zod schema by exact name + composable path', () => {
    expect(code).toContain("import { shopProductSchema } from './app/composables/useShopProducts'")
  })

  it('accepts a valid sample whose required string is non-empty (schema is .min(1))', () => {
    // required string must be present AND non-empty — z.string().min(1) rejects ''
    expect(code).toMatch(/name:\s*'[^']+'/)
    expect(code).not.toMatch(/name:\s*''/)
    expect(code).toContain('.safeParse(')
    expect(code).toMatch(/success\)\.toBe\(true\)/)
  })

  it('samples a numeric field as a number, not a string (matches z.number())', () => {
    // the sample is derived from field.zod, so a decimal/number field is 1, not 'sample'
    expect(code).toMatch(/price:\s*1\b/)
    expect(code).not.toMatch(/price:\s*'/)
  })

  it('rejects an invalid sample', () => {
    expect(code).toMatch(/success\)\.toBe\(false\)/)
  })

  it('omits auto/system fields from the sample', () => {
    expect(code).not.toMatch(/\bteamId:/)
    expect(code).not.toMatch(/\bcreatedAt:/)
    expect(code).not.toMatch(/^\s*id:/m)
  })

  it('still emits a reject case when the collection has no required fields', () => {
    const c = generateCollectionTest({
      ...baseData,
      fields: [
        { name: 'id', type: 'string', meta: { primaryKey: true } },
        { name: 'note', type: 'text', meta: {} },
      ],
    }, null)
    expect(c).toMatch(/success\)\.toBe\(false\)/)
  })

  it('emits no nondeterministic calls', () => {
    expect(code).not.toContain('Date.now(')
    expect(code).not.toContain('Math.random(')
  })
})
