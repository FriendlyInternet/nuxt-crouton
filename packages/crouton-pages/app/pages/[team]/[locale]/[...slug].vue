<script setup lang="ts">
import { localeLessTarget, stripTeamPrefix } from '../../../utils/custom-domain-path'

/**
 * Public Page Route with Locale
 *
 * Renders pages at /[team]/[locale]/[slug] URLs through the shared renderer
 * (CroutonPagesPublicPage). Supports custom domains via domain resolver middleware.
 *
 * URL patterns:
 * - /acme/en/about-us → team=acme, locale=en, slug=about-us
 * - /acme/fr/a-propos → team=acme, locale=fr, slug=a-propos
 * - /acme/nl/over-ons → team=acme, locale=nl, slug=over-ons
 *
 * With croutonPages.hideLocaleInUrl on (team mode, one locale) this route's
 * path is pinned to that one locale at build time and it forwards (302) to the
 * plain address: /acme/en/about → /acme/about. That address is rendered by
 * [team]/[...slug].vue.
 */
import { buildPagePath } from '../../../utils/page-path'

definePageMeta({
  layout: 'public',
  // Validate route params BEFORE setup runs. This prevents "$setup.t is not a
  // function" SSR errors caused by throwing createError() inside async setup
  // (the rejected promise is detected by Node before Nuxt's Suspense catches it).
  validate: async (route) => {
    const reservedPrefixes = ['auth', 'api', 'admin', 'dashboard', '_nuxt', '__nuxt']
    const teamParam = route.params.team as string

    // Reject reserved prefixes and file-like paths (e.g., favicon.svg, robots.txt)
    if (!teamParam || reservedPrefixes.includes(teamParam) || teamParam.includes('.')) {
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
const { hideTeamInLinks, hideLocaleInUrl, isTeamHost, resolvedTeamSlug } = useDomainContext()
const { locales, defaultLocale: i18nDefaultLocale } = useI18n()
const urlLocale = computed(() => route.params.locale as string)

// On a connected domain the server writes the Location header verbatim, so the
// team prefix is stripped there; on the client the team-host history hides it (#4175).
const forward = (p: string) => (import.meta.server && isTeamHost.value) ? stripTeamPrefix(p, resolvedTeamSlug.value!) : p

const slugParts = route.params.slug
const slugPath = !slugParts || (Array.isArray(slugParts) && slugParts.length === 0)
  ? ''
  : Array.isArray(slugParts) ? slugParts.join('/') : slugParts

const validLocales = locales.value.map((l: { code: string }) => l.code)
// Connected domain: an address without a language (/about → /acme/about,
// team=acme locale=about) forwards to the default locale (#4175).
const forwardsLocaleLess = !hideLocaleInUrl.value && isTeamHost.value && !validLocales.includes(urlLocale.value)

if (hideLocaleInUrl.value) {
  // 302, not 301: the setting can be turned off again, and a cached 301 would
  // pin visitors to an address that then 404s.
  await navigateTo(forward(buildPagePath({
    hideTeamInUrl: hideTeamInLinks.value,
    hideLocaleInUrl: true,
    team: route.params.team as string,
    locale: urlLocale.value,
    slugPath
  })), { redirectCode: 302 })
}
else if (forwardsLocaleLess) {
  const defaultLoc = validLocales.length === 1
    ? validLocales[0]!
    : ((i18nDefaultLocale as string) || validLocales[0]!)
  await navigateTo(
    forward(localeLessTarget(route.params.team as string, urlLocale.value, slugPath, defaultLoc)),
    { redirectCode: 302 }
  )
}
</script>

<template>
  <div v-if="hideLocaleInUrl || forwardsLocaleLess" />
  <CroutonPagesPublicPage v-else :locale="urlLocale" />
</template>
