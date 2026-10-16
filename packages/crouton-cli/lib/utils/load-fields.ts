// Load and parse a fields schema JSON file into typed Field objects

import fsp from 'node:fs/promises'
import path from 'node:path'
import { mapType } from './helpers.ts'

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
