// Utility functions for case conversion and type mapping
import { pascalCase, snakeCase, kebabCase } from 'scule'
import pluralize from 'pluralize'

export const pascal = pascalCase
export const toSnakeCase: (str: string) => string = snakeCase
export const toKebabCase = kebabCase

/** `knowledge-base` / `my_app` → `knowledgeBase` / `myApp`; an already-camel layer is unchanged. */
export function toLayerCamelCase(layer: string): string {
  return layer
    .split(/[-_]/)
    .map((part, index) => index === 0 ? part : part.charAt(0).toUpperCase() + part.slice(1))
    .join('')
}

export interface CaseVariants {
  singular: string
  plural: string
  pascalCase: string
  pascalCasePlural: string
  camelCase: string
  camelCasePlural: string
  upperCase: string
  kebabCase: string
}

export function toCase(str: string): CaseVariants {
  // Use npm `pluralize` for proper English rules (category↔categories, entry↔entries,
  // equipment uncountable). The previous naive `str + 's'` / `str.slice(0,-1)` broke
  // any word ending in 'y' and double-pluralized uncountables.
  const singular = pluralize.singular(str)
  const plural = pluralize(str)

  // Use the pascal() helper to properly convert hyphenated names
  const singularPascal = pascal(singular)
  const pluralPascal = pascal(plural)

  return {
    singular: singular.toLowerCase(),
    plural: plural.toLowerCase(),
    pascalCase: singularPascal,
    pascalCasePlural: pluralPascal,
    camelCase: singularPascal.charAt(0).toLowerCase() + singularPascal.slice(1),
    camelCasePlural: pluralPascal.charAt(0).toLowerCase() + pluralPascal.slice(1),
    upperCase: singular.toUpperCase(),
    kebabCase: singular.toLowerCase().replace(/[A-Z]/g, '-$&').toLowerCase(),
  }
}

/**
 * Validate and normalize a field type against a set of known types.
 */
export function mapType(t: string, validTypes?: Set<string>): string {
  // `integer` is an alias for `number` (crouton's int column type). Normalize it
  // up front so schemas declaring "type": "integer" produce integer columns
  // instead of silently falling back to text. Everything downstream keys off the
  // resolved `number` type (schema → integer(), zod → z.number(), ts → number).
  if (t === 'integer') t = 'number'
  if (validTypes) {
    return validTypes.has(t) ? t : 'string'
  }
  // Fallback for callers that don't pass validTypes (backward compat during migration)
  return ['string', 'text', 'richText', 'number', 'decimal', 'boolean', 'date', 'json', 'repeater', 'array', 'image', 'file'].includes(t) ? t : 'string'
}

interface Field {
  name: string
  type: string
  seed?: { drizzleSeed: string }
}

/**
 * Get the drizzle-seed generator for a field based on name and type
 */
export function getSeedGenerator(field: Field): string {
  const { name, seed } = field
  const n = name.toLowerCase()

  // Name-based heuristics (more specific patterns first)
  if (n.includes('email')) return 'f.email()'
  if (n === 'name' || n === 'fullname' || n === 'full_name') return 'f.fullName()'
  if (n === 'firstname' || n === 'first_name') return 'f.firstName()'
  if (n === 'lastname' || n === 'last_name') return 'f.lastName()'
  if (n === 'title') return 'f.loremIpsum({ sentencesCount: 1 })'
  if (n === 'description' || n === 'bio' || n === 'content' || n === 'summary') return 'f.loremIpsum({ sentencesCount: 3 })'
  if (n.includes('phone')) return 'f.phoneNumber()'
  if (n.includes('url') || n.includes('website') || n.includes('link')) return 'f.valuesFromArray({ values: ["https://example.com"] })'
  if (n === 'slug') return 'f.loremIpsum({ sentencesCount: 1 })'
  if (n.includes('price') || n.includes('amount') || n.includes('cost') || n.includes('total')) return 'f.number({ minValue: 1, maxValue: 1000, precision: 100 })'
  if (n.includes('quantity') || n.includes('count') || n.includes('stock')) return 'f.int({ minValue: 0, maxValue: 100 })'
  if (n.includes('address')) return 'f.streetAddress()'
  if (n === 'city') return 'f.city()'
  if (n === 'country') return 'f.country()'
  if (n === 'state' || n === 'province') return 'f.state()'
  if (n.includes('zip') || n.includes('postal')) return 'f.postcode()'
  if (n === 'status') return 'f.valuesFromArray({ values: ["active", "inactive", "pending"] })'
  if (n === 'type' || n === 'category') return 'f.valuesFromArray({ values: ["type_a", "type_b", "type_c"] })'

  // Type-based: the manifest declares the generator per field type (loadFields
  // stamps it on the field). Only a type the manifest doesn't know falls back.
  return seed?.drizzleSeed ?? 'f.loremIpsum({ sentencesCount: 1 })'
}

// typeMapping has been removed — use loadTypeMapping() from manifest-loader.ts
// The canonical type definitions now live in crouton-core/crouton.manifest.ts

/** Escape a value for embedding inside a single-quoted JS/TS string literal. */
export function jsString(value: unknown): string {
  return String(value)
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
}

/** Escape a value for embedding inside a double-quoted HTML/Vue attribute. */
export function htmlAttr(value: unknown): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

/** Render an option value as a JS literal, keeping numbers/booleans typed and quoting strings. */
export function jsLiteral(value: unknown): string {
  return typeof value === 'number' || typeof value === 'boolean' ? String(value) : `'${jsString(value)}'`
}
