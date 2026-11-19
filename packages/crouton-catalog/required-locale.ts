/**
 * The one language a translated record must have — the same rule the
 * translation input (crouton-i18n `Input.vue`) uses to pick its default tab:
 * the app's `defaultLocale` when it is one of the configured locales, else the
 * first configured locale, else `defaultLocale`, else `'en'`.
 *
 * Pure and imported explicitly (`@fyit/crouton-catalog/required-locale`), never
 * auto-imported, so it can't clash with another layer's names.
 */
export function requiredLocale(codes: string[], defaultLocale?: string | null): string {
  if (defaultLocale && codes.includes(defaultLocale)) return defaultLocale
  if (codes.length > 0 && codes[0]) return codes[0]
  return defaultLocale || 'en'
}

/** Normalise i18n locales (strings or `{ code }` objects) to their codes. */
export function localeCodes(locales: ReadonlyArray<string | { code: string }> | null | undefined): string[] {
  return (locales ?? []).map(l => (typeof l === 'string' ? l : l.code))
}
