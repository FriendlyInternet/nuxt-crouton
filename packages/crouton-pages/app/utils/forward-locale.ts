/**
 * The language a no-language public address (/acme, /acme/about) forwards to.
 *
 * Every input must exist on BOTH the server and the browser, so the two pick
 * the same language (#4292): the live `useI18n()` values, and
 * `runtimeConfig.public.i18n` (written by @nuxtjs/i18n from the same
 * croutonLocales / croutonDefaultLocale crouton-i18n sets). Never pass the
 * private `croutonI18n` runtime config key — it is undefined in the browser.
 */
export interface ForwardLocaleInput {
  /** Live `useI18n().locale` (may be a stale cookie value). */
  live?: string
  /** Live `useI18n().locales` codes. */
  liveLocales?: string[]
  /** Live `useI18n().defaultLocale`. */
  liveDefault?: string
  /** `runtimeConfig.public.i18n.locales` (strings or `{ code }` objects). */
  configLocales?: Array<string | { code: string }>
  /** `runtimeConfig.public.i18n.defaultLocale`. */
  configDefault?: string
  /** `runtimeConfig.public.croutonPages.defaultLocale`. */
  pagesDefault?: string
}

export function resolveForwardLocale(input: ForwardLocaleInput): string {
  const liveLocales = input.liveLocales ?? []
  let live = input.live || ''

  // Drop a live locale this app doesn't support — e.g. a stale
  // `i18n_redirected` cookie left by another crouton app on the same host.
  if (live && liveLocales.length && !liveLocales.includes(live)) live = ''
  if (live) return live

  const configLocales = (input.configLocales ?? [])
    .map(l => (typeof l === 'string' ? l : l?.code))
    .filter((c): c is string => !!c)

  return (liveLocales.length === 1 ? liveLocales[0]! : '')
    || input.liveDefault
    || (configLocales.length === 1 ? configLocales[0]! : '')
    || input.configDefault
    || input.pagesDefault
    || 'en'
}
