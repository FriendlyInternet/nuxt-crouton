// The docs connector's schema checker (validate_schema, #3165).
// The allowed keys come from the generator itself, so this can never say "valid" to a key
// crouton-cli ignores or refuses — consume the list, don't fork it.
import { ALLOWED_FIELD_KEYS, ALLOWED_META_KEYS } from '@fyit/crouton-cli/lib/utils/load-fields.ts'

export const VALID_FIELD_TYPES = ['string', 'text', 'number', 'decimal', 'boolean', 'date', 'json', 'repeater', 'array']

export interface SchemaCheck {
  errors: string[]
  warnings: string[]
}

type Def = Record<string, any>

function levenshtein(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0]!
    row[0] = i
    for (let j = 1; j <= b.length; j++) {
      const tmp = row[j]!
      row[j] = Math.min(row[j]! + 1, row[j - 1]! + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1))
      prev = tmp
    }
  }
  return row[b.length]!
}

/** The real key a typo most likely meant: case-insensitive match first, then edit distance ≤ 2. */
export function closestKey(key: string, allowed: Iterable<string>): string | undefined {
  const list = [...allowed]
  const lower = key.toLowerCase()
  const exact = list.find(k => k.toLowerCase() === lower)
  if (exact) return exact
  let best: string | undefined
  let bestDist = 3
  for (const k of list) {
    const d = levenshtein(lower, k.toLowerCase())
    if (d < bestDist) {
      best = k
      bestDist = d
    }
  }
  return best
}

const isPlainObject = (v: unknown): v is Def => typeof v === 'object' && v !== null && !Array.isArray(v)

function fieldKeyHint(key: string, def: Def): string {
  if (key === 'children' && def.type === 'repeater') return 'put the item fields in meta.properties'
  if (ALLOWED_META_KEYS.has(key)) return `move it under meta`
  const close = closestKey(key, ALLOWED_FIELD_KEYS)
  return close ? `did you mean "${close}"?` : `allowed: ${[...ALLOWED_FIELD_KEYS].join(', ')} (field options go under meta)`
}

function checkType(def: Def): string[] {
  if (!def.type) return [`Missing required "type" property`]
  if (!VALID_FIELD_TYPES.includes(def.type)) return [`Invalid type "${def.type}". Valid types: ${VALID_FIELD_TYPES.join(', ')}`]
  return []
}

function checkFieldKeys(def: Def): string[] {
  return Object.keys(def)
    .filter(key => !ALLOWED_FIELD_KEYS.has(key))
    .map(key => `unknown key "${key}" — ignored by the generator; ${fieldKeyHint(key, def)}`)
}

function checkRefTarget(def: Def): string[] {
  return def.refTarget !== undefined && typeof def.refTarget !== 'string' ? ['refTarget must be a string (collection name)'] : []
}

function checkMetaKeys(meta: Def): string[] {
  return Object.keys(meta)
    .filter(key => !ALLOWED_META_KEYS.has(key))
    .map((key) => {
      const close = closestKey(key, ALLOWED_META_KEYS)
      return close
        ? `unknown meta key "${key}" — did you mean "${close}"?`
        : `unknown meta key "${key}" — allowed: ${[...ALLOWED_META_KEYS].join(', ')}`
    })
}

function checkOptions(meta: Def): string[] {
  if (meta.displayAs === 'optionsSelect') return []
  return (['options', 'optionsCollection'] as const)
    .filter(key => meta[key] !== undefined)
    .map(key => `\`${key}\` needs \`displayAs: "optionsSelect"\` to render as a dropdown — without it this is a plain text input`)
}

function checkReadOnly(def: Def, meta: Def): string[] {
  if (meta.readOnly === undefined || def.refTarget) return []
  return [`\`readOnly\` only works on reference fields (with refTarget) — on a ${def.type ?? 'plain'} field it is ignored`]
}

function checkDecimal(def: Def, meta: Def): string[] {
  if (def.type !== 'decimal') return []
  return (['precision', 'scale'] as const)
    .filter(key => meta[key] !== undefined && typeof meta[key] !== 'number')
    .map(key => `${key} must be a number`)
}

/** Every rule for one field definition; messages are prefixed with the field name by the caller. */
function checkField(def: Def): SchemaCheck {
  const errors = [...checkType(def), ...checkFieldKeys(def), ...checkRefTarget(def)]
  if (def.meta !== undefined && !isPlainObject(def.meta)) {
    return { errors: [...errors, '"meta" must be an object'], warnings: [] }
  }
  const meta: Def = def.meta ?? {}
  errors.push(...checkMetaKeys(meta), ...checkOptions(meta), ...checkReadOnly(def, meta), ...checkDecimal(def, meta))
  const warnings = def.type === 'repeater' && !meta.properties && !def.children
    ? ['repeater should define its item fields in meta.properties']
    : []
  return { errors, warnings }
}

/** Check a keyed-format schema; one error per mistake, each naming its fix. */
export function checkCroutonSchema(schema: Record<string, any>): SchemaCheck {
  const result: SchemaCheck = { errors: [], warnings: [] }
  for (const [fieldName, fieldDef] of Object.entries(schema)) {
    const prefix = (msg: string) => `Field "${fieldName}": ${msg}`
    if (!/^[a-zA-Z][a-zA-Z0-9]*$/.test(fieldName)) {
      result.errors.push(prefix('Name must start with a letter and contain only alphanumeric characters'))
    }
    if (!isPlainObject(fieldDef)) {
      result.errors.push(prefix('Definition must be an object'))
      continue
    }
    const { errors, warnings } = checkField(fieldDef)
    result.errors.push(...errors.map(prefix))
    result.warnings.push(...warnings.map(prefix))
  }
  return result
}
