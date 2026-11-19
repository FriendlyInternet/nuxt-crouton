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

type LocaleList = ReadonlyArray<string | { code: string }>

/**
 * The part of `useI18n()` a form needs. The form component (where `useI18n`
 * is a typed Nuxt auto-import) passes its `useI18n()` result in, so the form
 * composables never call `useI18n` themselves — they are also type-checked
 * from server code, where it doesn't exist.
 */
export interface FormI18n {
  locales?: LocaleList | { value: LocaleList } | null
  defaultLocale?: string | { value?: string | null } | null
}

/** The required language for a form, from its `useI18n()` (none → `'en'`). */
export function formRequiredLocale(i18n?: FormI18n | null): string {
  const list = i18n?.locales
  const locales = list && 'value' in list ? list.value : (list as LocaleList | null | undefined)
  const def = i18n?.defaultLocale
  const defaultLocale = def && typeof def === 'object' ? def.value : def
  return requiredLocale(localeCodes(locales), defaultLocale)
}

/** Normalise i18n locales (strings or `{ code }` objects) to their codes. */
export function localeCodes(locales: ReadonlyArray<string | { code: string }> | null | undefined): string[] {
  return (locales ?? []).map(l => (typeof l === 'string' ? l : l.code))
}
