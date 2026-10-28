// Load and parse a fields schema JSON file into typed Field objects

import fsp from 'node:fs/promises'
import path from 'node:path'
import { mapType } from './helpers.ts'
import { AUTO_GENERATED_FIELDS, SYSTEM_FIELD_GROUPS } from './system-fields.ts'

export interface Field {
  name: string
  type: string
  meta: Record<string, any>
  refTarget?: string
  refScope?: string
  zod: string
  default: string
  tsType: string
  /** Form control declared by the manifest for this field's (canonical) type; undefined for unknown types (#2286) */
  component?: string
}

const FIELD_NAME_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/

/** Names a user field may not take: system columns (incl. hierarchy defaults) and the translations relation. */
const RESERVED_FIELD_NAMES = new Set<string>([
  ...AUTO_GENERATED_FIELDS,
  ...Object.values(SYSTEM_FIELD_GROUPS).flat(),
  'translations'
])

/** Every `meta` key a generator reads. Anything else is a typo that would be silently ignored. */
export const ALLOWED_META_KEYS: ReadonlySet<string> = new Set([
  'required', 'nullable', 'unique', 'default', 'maxLength', 'precision', 'scale', 'min', 'max',
  'area', 'group', 'label', 'description', 'help', 'readOnly', 'sortable',
  'component', 'displayAs', 'picker', 'url',
  'options', 'optionsCollection', 'optionsField', 'optionsValueField', 'optionsLabelField', 'labelField', 'creatable',
  'dependsOn', 'dependsOnCollection', 'dependsOnField',
  'translatable', 'translatableProperties',
  'properties', 'addLabel', 'repeaterComponent'
])

/**
 * Throw one line naming the field when a name / type / meta key can't be generated safely (#2732).
 * Strict by design: an invalid name emits syntax errors in schema.ts / types.ts / _Form.vue.
 */
export function validateField(name: unknown, def: Record<string, any> | undefined, validTypes: Set<string>): void {
  if (typeof name !== 'string' || !FIELD_NAME_RE.test(name)) {
    throw new Error(`Invalid field name ${JSON.stringify(name)}: must match ${FIELD_NAME_RE} (letters, digits, underscore; not starting with a digit)`)
  }
  if (RESERVED_FIELD_NAMES.has(name)) {
    throw new Error(`Field "${name}" collides with a system field: ${[...RESERVED_FIELD_NAMES].join(', ')}`)
  }
  // No manifest discovered (crouton-core not installed) → no type list to check against; loadFields warns once.
  if (validTypes.size > 0 && (typeof def?.type !== 'string' || !validTypes.has(def.type))) {
    throw new Error(`Field "${name}" has unknown type ${JSON.stringify(def?.type)}: allowed ${[...validTypes].sort().join(', ')}`)
  }
  for (const key of Object.keys(def.meta || {})) {
    if (!ALLOWED_META_KEYS.has(key)) {
      throw new Error(`Field "${name}" has unknown meta key "${key}": allowed ${[...ALLOWED_META_KEYS].join(', ')}`)
    }
  }
}

export async function loadFields(p: string, typeMapping: Record<string, any>): Promise<Field[]> {
  // If path is relative and doesn't exist, check in schemas directory
  if (!path.isAbsolute(p) && !await fsp.access(p).then(() => true).catch(() => false)) {
    const schemasPath = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'schemas', p)
    if (await fsp.access(schemasPath).then(() => true).catch(() => false)) {
      p = schemasPath
    }
  }
  const raw = await fsp.readFile(p, 'utf8')
  const obj = JSON.parse(raw) as Record<string, any>

  const validTypes = new Set(Object.keys(typeMapping))

  // Detect schema format:
  // - Array format: { name, label, fields: [...] } — used by package manifests (e.g. crouton-pages)
  // - Keyed format: { fieldName: { type, meta: {...} } } — used by generated app schemas
  let entries: Array<[string, Record<string, any>]>

  if (Array.isArray(obj.fields)) {
    // Array format: convert each field to [name, meta] tuple
    entries = (obj.fields as Array<Record<string, any>>).map((field) => {
      const { name, type, refTarget, refScope, ...rest } = field
      // Everything except name/type/refTarget/refScope becomes meta
      return [name as string, { type, refTarget, refScope, meta: rest }]
    })
  } else {
    // Keyed format: { fieldName: { type, meta, refTarget, refScope } }
    entries = Object.entries(obj) as Array<[string, Record<string, any>]>
  }

  if (validTypes.size === 0) console.warn('⚠ No field types discovered from crouton manifests — skipping field type validation')
  for (const [name, def] of entries) validateField(name, def, validTypes)

  return entries.map(([name, meta]) => {
    const fieldMeta = meta?.meta || {} as Record<string, any>
    // Set default area if not specified
    if (!fieldMeta.area) {
      fieldMeta.area = 'main'
    }

    // Resolve aliases (e.g. `datetime` → `date`, `integer` → `number`) to the
    // canonical type so every downstream generator that branches on `field.type`
    // sees the canonical name. typeMapping carries `canonical` for both canonical
    // and alias keys; fall back to mapType for unknown types (#285).
    const resolvedType = typeMapping[meta?.type]?.canonical ?? mapType(meta?.type, validTypes)

    attachPropertyComponents(fieldMeta, typeMapping)
    return {
      name,
      type: resolvedType,
      meta: fieldMeta,
      refTarget: meta?.refTarget,
      refScope: meta?.refScope,
      zod: typeMapping[resolvedType]?.zod || 'z.string()',
      default: typeMapping[resolvedType]?.default || '\'\'',
      tsType: typeMapping[resolvedType]?.tsType || 'string',
      component: typeMapping[resolvedType]?.component
    }
  })
}

// Repeater item properties get the same treatment as fields: the manifest's
// `component` for their (canonical) type, so the item Input.vue renders what the
// manifest says instead of a private per-type map (#2286). Types are left as
// written — the property TS mapping has its own fallback — only `component` is
// attached, and an explicit `component` on the property wins.
function attachPropertyComponents(fieldMeta: Record<string, any>, typeMapping: Record<string, any>): void {
  const properties = fieldMeta.properties
  if (!properties || typeof properties !== 'object') return
  for (const def of Object.values(properties as Record<string, any>)) {
    if (!def || typeof def !== 'object' || def.component) continue
    const canonical = typeMapping[def.type]?.canonical ?? def.type
    const component = typeMapping[canonical]?.component
    if (component) def.component = component
  }
}
