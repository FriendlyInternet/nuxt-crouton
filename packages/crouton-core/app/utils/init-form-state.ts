/**
 * Build an edit form's initial state from the collection defaults + the record
 * being edited (#1498).
 *
 * The naive `{ ...defaultValue, ...activeItem }` merge is subtly wrong on the
 * edit path: a **nullable DB column round-trips `null`**, so the loaded record's
 * `null` overrides the form default (`''` / `[]` / `false`) and reaches the
 * generated **client** validation schema — which is `.optional()` (rejects
 * `null`), the deliberately-narrow side kept by #1403 (widening it to
 * `.nullish()` breaks typecheck across every generated form + package
 * component). The result: `UForm` silently refuses to submit, and hidden
 * fields show no error.
 *
 * The fix keeps `null` out of state without touching any schema or type: for a
 * key that IS a form field (present in `defaultValue`), a `null`/`undefined`
 * loaded value falls back to the default. System/audit fields (`id`, `teamId`,
 * timestamps) aren't form fields — they pass through untouched, so the update
 * still carries its `id`.
 */
export function initFormState(
  defaultValue: Record<string, any>,
  activeItem?: Record<string, any> | null
): Record<string, any> {
  const state: Record<string, any> = { ...defaultValue }
  if (!activeItem) return state
  for (const [key, value] of Object.entries(activeItem)) {
    // A form field loaded as null/undefined keeps its default; everything else
    // (real values, plus non-form system fields) is taken from the record.
    if (value == null && key in defaultValue) continue
    state[key] = value
  }
  return state
}
