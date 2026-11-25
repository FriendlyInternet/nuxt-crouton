/**
 * Footer Page Composable
 *
 * Fetches the singleton footer page (pageType: 'pages:footer') for the current team.
 * Returns parsed block content ready for rendering.
 *
 * @example
 * ```vue
 * <script setup>
 * const { footer, content, isLoading } = useFooterPage()
 * </script>
 *
 * <template>
 *   <CroutonPagesBlockContent v-if="content" :content="content" />
 * </template>
 * ```
 */
export function useFooterPage(teamSlug?: MaybeRef<string | null>) {
  const route = useRoute()
  // useT() rather than raw useI18n(): safe on public/SSR routes where the i18n
  // auto-import can be unavailable ("useI18n is not defined").
  const { locale: i18nLocale } = useT()
  const { teamId } = useTeamContext()

  const runtimeConfig = useRuntimeConfig()
  const pagesConfig = (runtimeConfig.public?.croutonPages as any) as { defaultLocale?: string } | undefined
  const defaultTeamSlug = (runtimeConfig.public?.crouton as any)?.auth?.teams?.defaultTeamSlug as string | undefined
  const locale = computed(() => i18nLocale.value || pagesConfig?.defaultLocale || 'en')

  // Resolve team from prop, route, or auth context
  const routeTeam = computed(() => {
    const param = route.params.team
    if (typeof param !== 'string') return null
    return param
  })
  const team = computed(() => {
    const teamValue = toValue(teamSlug)
    if (teamValue) return teamValue
    return routeTeam.value || teamId.value || defaultTeamSlug || null
  })

  // Fetch footer page by pageType filter
  // Uses useAsyncData + $fetch to avoid useFetch dedup issues during SSR
  // (in locale routing mode, team may not resolve until after initial SSR render)
  const { data: footerData, pending: isLoading, refresh } = useAsyncData(
    () => `footer-page-${team.value}`,
    async () => {
      if (!team.value) return null
      const data = await $fetch<any>(`/api/teams/${team.value}/pages`, {
        params: { pageType: 'pages:footer', locale: locale.value }
      })
      const pages = data?.data || data || []
      return pages[0] || null
    },
    { watch: [team, locale] }
  )

  // Parsed footer page record
  const footer = computed(() => footerData.value)

  // Resolved content (locale-aware) — block JSON string or parsed object
  const content = computed(() => {
    const page = footer.value
    if (!page) return null

    // Try localized content from translations
    if (page.translations) {
      const localeContent = page.translations[locale.value]?.content
      if (localeContent) return localeContent
      // Fallback to English
      if (page.translations.en?.content) return page.translations.en.content
    }

    return page.content || null
  })

  // Refresh when pages are mutated
  useMutationListener((event) => {
    if (event?.collection === 'pagesPages') {
      refresh()
    }
  })

  return {
    /** The raw footer page record (or null if none exists) */
    footer,
    /** Localized block content string ready for CroutonPagesBlockContent */
    content,
    /** Whether the footer is still loading */
    isLoading,
    /** Refresh the footer data */
    refresh
  }
}
