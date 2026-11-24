/**
 * Pure helpers for the Look & Feel page (TeamThemeSettings / TeamRadiusPicker).
 * Plain TS, imported explicitly; tested in test/theme-picker.test.ts (#4479).
 */

/** Show the preset list only when there is a real choice, or the team saved a named preset. */
export function showPresetPicker(available: Record<string, unknown>, currentPreset?: string): boolean {
  return Object.keys(available).length > 1 || (!!currentPreset && currentPreset !== 'custom')
}

/** Tailwind palette name → display name ('emerald' → 'Emerald'). Kept English in every locale. */
export function colorLabel(name?: string): string {
  if (!name) return ''
  return name.charAt(0).toUpperCase() + name.slice(1)
}

/** Corner radius (rem) → plain name. */
export const RADIUS_NAMES: Record<number, string> = {
  0: 'square',
  0.125: 'slight',
  0.25: 'soft',
  0.375: 'rounded',
  0.5: 'round'
}

/**
 * Name a radius value. Without `translate` returns the English name; with it,
 * returns `translate('themeSettings.radius<Name>')`. Unknown values → the number.
 */
export function radiusLabel(value: number, translate?: (key: string) => string): string {
  const name = RADIUS_NAMES[value]
  if (!name) return String(value)
  const cap = colorLabel(name)
  return translate ? translate(`themeSettings.radius${cap}`) : cap
}
