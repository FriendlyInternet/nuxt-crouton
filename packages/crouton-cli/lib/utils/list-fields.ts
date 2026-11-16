/**
 * The one list rule shared by the schema generator and the generated tests (#3600).
 *
 * A field's body value is a list when the server body schema for it is a `z.array(...)`.
 */

/** A dependent field (depends on another collection's value, or a slot button group) — wire shape is `string[]`. */
export function isDependentField(f: Record<string, any>): boolean {
  return Boolean((f.meta?.dependsOn && f.meta?.dependsOnCollection) || f.meta?.displayAs === 'slotButtonGroup')
}

/** True when the server body schema for this field is a `z.array(...)`. */
export function isListField(f: Record<string, any>): boolean {
  return isDependentField(f) || String(f.zod || '').startsWith('z.array(') || f.type === 'array'
}
