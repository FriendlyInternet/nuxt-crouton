import { withManifest } from '../../helpers/manifest-fields.ts'
import { describe, it, expect } from 'vitest'
import {
  pascal,
  toSnakeCase,
  toCase,
  mapType,
  getSeedGenerator
} from '../../../lib/utils/helpers.ts'
import { seedTestFields } from '../../fixtures/sample-data.mjs'

describe('pascal', () => {
  it('converts lowercase to PascalCase', () => {
    expect(pascal('product')).toBe('Product')
  })

  it('converts kebab-case to PascalCase', () => {
    expect(pascal('my-collection')).toBe('MyCollection')
  })

  it('converts snake_case to PascalCase', () => {
    expect(pascal('my_collection')).toBe('MyCollection')
  })

  it('handles already PascalCase', () => {
    expect(pascal('MyCollection')).toBe('MyCollection')
  })

  it('handles multiple words', () => {
    expect(pascal('my-long-collection-name')).toBe('MyLongCollectionName')
  })

  it('handles empty string', () => {
    expect(pascal('')).toBe('')
  })
})

describe('toSnakeCase', () => {
  it('converts camelCase to snake_case', () => {
    expect(toSnakeCase('myCollection')).toBe('my_collection')
  })

  it('converts PascalCase to snake_case', () => {
    expect(toSnakeCase('MyCollection')).toBe('my_collection')
  })

  it('converts kebab-case to snake_case', () => {
    expect(toSnakeCase('my-collection')).toBe('my_collection')
  })

  it('handles already snake_case', () => {
    expect(toSnakeCase('my_collection')).toBe('my_collection')
  })

  it('handles multiple capitals', () => {
    expect(toSnakeCase('myLongCollectionName')).toBe('my_long_collection_name')
  })
})

describe('toCase', () => {
  it('returns all case variations for singular word', () => {
    const result = toCase('product')
    expect(result).toEqual({
      singular: 'product',
      plural: 'products',
      pascalCase: 'Product',
      pascalCasePlural: 'Products',
      camelCase: 'product',
      camelCasePlural: 'products',
      upperCase: 'PRODUCT',
      kebabCase: 'product'
    })
  })

  it('handles plural input by detecting -s suffix', () => {
    const result = toCase('products')
    expect(result.singular).toBe('product')
    expect(result.plural).toBe('products')
  })

  it('handles kebab-case input', () => {
    const result = toCase('my-product')
    expect(result.pascalCase).toBe('MyProduct')
    expect(result.pascalCasePlural).toBe('MyProducts')
  })

  it('handles single character', () => {
    const result = toCase('a')
    expect(result.singular).toBe('a')
    expect(result.plural).toBe('as')
  })

  // Regression: previous naive pluralizer (`str + 's'`) produced `categorys`,
  // `entrys`, etc. The npm `pluralize` library handles English `y → ies` correctly.
  it('pluralizes words ending in -y correctly', () => {
    expect(toCase('category').plural).toBe('categories')
    expect(toCase('entry').plural).toBe('entries')
    expect(toCase('country').plural).toBe('countries')
    expect(toCase('category').pascalCasePlural).toBe('Categories')
  })

  it('singularizes -ies plurals correctly', () => {
    expect(toCase('categories').singular).toBe('category')
    expect(toCase('entries').singular).toBe('entry')
  })

  it('handles uncountable nouns (no double-pluralization)', () => {
    expect(toCase('equipment').plural).toBe('equipment')
    expect(toCase('equipment').singular).toBe('equipment')
  })

  it('is idempotent on already-plural input', () => {
    expect(toCase('categories').plural).toBe('categories')
    expect(toCase('products').plural).toBe('products')
  })
})

describe('mapType', () => {
  it('returns valid type unchanged (fallback mode)', () => {
    expect(mapType('string')).toBe('string')
    expect(mapType('text')).toBe('text')
    expect(mapType('number')).toBe('number')
    expect(mapType('decimal')).toBe('decimal')
    expect(mapType('boolean')).toBe('boolean')
    expect(mapType('date')).toBe('date')
    expect(mapType('json')).toBe('json')
    expect(mapType('repeater')).toBe('repeater')
    expect(mapType('array')).toBe('array')
  })

  it('returns string for unknown types (fallback mode)', () => {
    expect(mapType('unknown')).toBe('string')
    expect(mapType('invalid')).toBe('string')
    expect(mapType('')).toBe('string')
  })

  it('validates against provided validTypes set', () => {
    const validTypes = new Set(['string', 'number', 'custom'])
    expect(mapType('string', validTypes)).toBe('string')
    expect(mapType('custom', validTypes)).toBe('custom')
    expect(mapType('boolean', validTypes)).toBe('string') // not in validTypes
    expect(mapType('unknown', validTypes)).toBe('string')
  })
})

describe('getSeedGenerator', () => {
  it('returns email generator for email fields', () => {
    expect(getSeedGenerator({ name: 'email', type: 'string' })).toBe('f.email()')
    expect(getSeedGenerator({ name: 'userEmail', type: 'string' })).toBe('f.email()')
  })

  it('returns fullName generator for name fields', () => {
    expect(getSeedGenerator({ name: 'name', type: 'string' })).toBe('f.fullName()')
    expect(getSeedGenerator({ name: 'fullName', type: 'string' })).toBe('f.fullName()')
  })

  it('returns firstName/lastName generators', () => {
    expect(getSeedGenerator({ name: 'firstName', type: 'string' })).toBe('f.firstName()')
    expect(getSeedGenerator({ name: 'lastName', type: 'string' })).toBe('f.lastName()')
  })

  it('returns loremIpsum for title fields', () => {
    expect(getSeedGenerator({ name: 'title', type: 'string' })).toBe('f.loremIpsum({ sentencesCount: 1 })')
  })

  it('returns loremIpsum for description/content fields', () => {
    expect(getSeedGenerator({ name: 'description', type: 'text' })).toBe('f.loremIpsum({ sentencesCount: 3 })')
    expect(getSeedGenerator({ name: 'content', type: 'text' })).toBe('f.loremIpsum({ sentencesCount: 3 })')
  })

  it('returns phoneNumber for phone fields', () => {
    expect(getSeedGenerator({ name: 'phone', type: 'string' })).toBe('f.phoneNumber()')
    expect(getSeedGenerator({ name: 'phoneNumber', type: 'string' })).toBe('f.phoneNumber()')
  })

  it('returns number generator for price fields', () => {
    expect(getSeedGenerator({ name: 'price', type: 'decimal' })).toBe('f.number({ minValue: 1, maxValue: 1000, precision: 100 })')
    expect(getSeedGenerator({ name: 'amount', type: 'decimal' })).toBe('f.number({ minValue: 1, maxValue: 1000, precision: 100 })')
  })

  it('returns int generator for quantity fields', () => {
    expect(getSeedGenerator({ name: 'quantity', type: 'number' })).toBe('f.int({ minValue: 0, maxValue: 100 })')
    expect(getSeedGenerator({ name: 'count', type: 'number' })).toBe('f.int({ minValue: 0, maxValue: 100 })')
  })

  it('returns address generators', () => {
    expect(getSeedGenerator({ name: 'address', type: 'string' })).toBe('f.streetAddress()')
    expect(getSeedGenerator({ name: 'city', type: 'string' })).toBe('f.city()')
  })

  it('returns valuesFromArray for status fields', () => {
    expect(getSeedGenerator({ name: 'status', type: 'string' })).toBe('f.valuesFromArray({ values: ["active", "inactive", "pending"] })')
  })

  it('falls back to type-based generator for unknown names', () => {
    expect(getSeedGenerator(withManifest([{ name: 'unknownField', type: 'string' }])[0])).toBe('f.loremIpsum({ sentencesCount: 1 })')
    expect(getSeedGenerator(withManifest([{ name: 'unknownField', type: 'text' }])[0])).toBe('f.loremIpsum({ sentencesCount: 3 })')
    expect(getSeedGenerator(withManifest([{ name: 'unknownField', type: 'number' }])[0])).toBe('f.int({ minValue: 0, maxValue: 100 })')
    expect(getSeedGenerator(withManifest([{ name: 'unknownField', type: 'boolean' }])[0])).toBe('f.weightedRandom([{ value: true, weight: 0.5 }, { value: false, weight: 0.5 }])')
    expect(getSeedGenerator(withManifest([{ name: 'unknownField', type: 'date' }])[0])).toBe('f.date({ minDate: "2020-01-01", maxDate: "2025-12-31" })')
    expect(getSeedGenerator(withManifest([{ name: 'unknownField', type: 'json' }])[0])).toBe('f.valuesFromArray({ values: [{}] })')
  })
})

// typeMapping has been removed from helpers.mjs — it now lives in
// crouton-core/crouton.manifest.ts and is loaded via manifest-loader.ts.
// See tests/unit/utils/manifest-loader.test.ts for type mapping tests.
