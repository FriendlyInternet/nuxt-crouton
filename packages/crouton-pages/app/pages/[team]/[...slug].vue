<script setup lang="ts">
import { rendersWithoutLocale } from '../../utils/public-routes'
import { stripTeamPrefix } from '../../utils/custom-domain-path'
/**
 * Public Page Route without Locale
 *
 * Answers the bare team address (/acme → 302 /acme/en) and the single-team
 * /nl/ case (team=nl, slug=[]). A no-locale page address like /acme/about
 * does NOT reach this route by default — [team]/[locale]/[...slug].vue takes
 * it (as locale="about") and shows "page not found".
 *
 * With croutonPages.hideLocaleInUrl on (team mode, one locale) the locale
 * route is pinned to that one code, so /acme/about lands here and this route
 * renders the page through CroutonPagesPublicPage instead of forwarding.
 * Otherwise rendering happens in [team]/[locale]/[...slug].vue.
 */
definePageMeta({
  // The public layout is only needed when this route renders a page
  // (hideLocaleInUrl). Set it in route middleware, not in setup, so the
  // server and the browser agree on the layout (no hydration mismatch).
  // Setting off: does nothing, so today's forward-only route is unchanged.
  middleware: [
    () => {
      if (rendersWithoutLocale(useRuntimeConfig().public.croutonPages as any)) setPageLayout('public')
    }
  ],
  validate: async (route) => {
    const reservedPrefixes = ['auth', 'api', 'admin', 'dashboard', '_nuxt', '__nuxt']
    const teamParam = route.params.team as string
    if (reservedPrefixes.includes(teamParam) || teamParam.includes('.')) {
      return false
    }

    // Verify team actually exists to avoid catching routes meant for other pages
    try {
      const { valid } = await $fetch<{ valid: boolean }>(`/api/crouton-pages/validate-team/${teamParam}`)
      return valid
    } catch {
      return false
    }
  }
})

const route = useRoute()
const { hideLocaleInUrl, isTeamHost, resolvedTeamSlug } = useDomainContext()

// Resolve which locale to normalize a no-locale URL to. Public pages use
// URL-driven locale (/[team]/[locale]/[slug] — a deliberate design choice), so a
// bare /team URL is canonicalised to the app's configured default locale, NOT a
// hardcoded 'en' (see commit "base/required locale follows defaultLocale").
//
// Prefer the live i18n locale when available; only when i18n is genuinely
// unavailable (rare SSR contexts — the reason this is guarded) do we fall back
// to config. croutonI18n.supportedLocales is driven by crouton.config.js, so a
// single-locale app resolves to that locale (e.g. 'nl') rather than 'en'.
const runtimeConfig = useRuntimeConfig()
const pagesConfig = runtimeConfig.public?.croutonPages as { defaultLocale?: string } | undefined
const i18nCfg = runtimeConfig.croutonI18n as { supportedLocales?: string[]; defaultLocale?: string } | undefined

let localeCode = ''
let supportedLocales: string[] = []
let i18nDefaultLocale = ''
try {
  const i18n = useI18n()
  localeCode = i18n.locale.value
  supportedLocales = (i18n.locales.value as Array<string | { code: string }>)
    .map(l => (typeof l === 'string' ? l : l.code))
  i18nDefaultLocale = (i18n.defaultLocale as string) || ''
} catch {
  if (import.meta.dev) {
    console.warn('[crouton-pages] useI18n() unavailable in redirect route, using configured default locale')
  }
}

// Discard a live locale that isn't actually supported by this app — e.g. a stale
// `i18n_redirected` cookie left by another crouton app on the same host. Using it
// would build an unreachable URL like /team/en/ for an nl-only app.
if (localeCode && supportedLocales.length && !supportedLocales.includes(localeCode)) {
  localeCode = ''
}

if (!localeCode) {
  // Resolve the app's configured default — never hardcode 'en' for a non-en app.
  localeCode = (supportedLocales.length === 1 ? supportedLocales[0]! : '')
    || i18nDefaultLocale
    || (i18nCfg?.supportedLocales?.length === 1 ? i18nCfg.supportedLocales[0]! : '')
    || i18nCfg?.defaultLocale
    || pagesConfig?.defaultLocale
    || 'en'
}

// Get team slug from route params (not teamId — context may not be resolved during client-side nav)
const team = route.params.team as string
const slugParts = route.params.slug
const slug = !slugParts || (Array.isArray(slugParts) && slugParts.length === 0)
  ? ''
  : Array.isArray(slugParts) ? slugParts.join('/') : slugParts

// Redirect to locale-prefixed URL. Use 302 (temporary), NOT 301: the locale
// segment is resolved at runtime (current/default locale), so the mapping isn't
// permanent — a 301 gets cached by browsers and pins the URL to a stale locale.
// With hideLocaleInUrl on, this IS the page address — render instead.
if (!hideLocaleInUrl.value) {
  const targetUrl = slug ? `/${team}/${localeCode}/${slug}` : `/${team}/${localeCode}/`

  // On a connected domain the server writes the Location header verbatim, so the
  // team prefix is stripped there; on the client the team-host history hides it (#4175).
  const forward = (p: string) => (import.meta.server && isTeamHost.value) ? stripTeamPrefix(p, resolvedTeamSlug.value!) : p

  await navigateTo(forward(targetUrl), { redirectCode: 302 })
}
</script>

<template>
  <CroutonPagesPublicPage v-if="hideLocaleInUrl" :locale="localeCode" />
  <div v-else />
</template>
