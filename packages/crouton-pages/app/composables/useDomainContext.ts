/**
 * Domain Context Composable
 *
 * Detects if the current request is from a custom domain or using locale
 * routing mode and provides context about the resolved team.
 *
 * @example
 * ```vue
 * <script setup>
 * const { isCustomDomain, hideTeamInUrl } = useDomainContext()
 *
 * // Hide team selector on custom domain / locale-mode sites
 * const showTeamSelector = computed(() => !hideTeamInUrl.value)
 * </script>
 * ```
 */
export function useDomainContext() {
  const nuxtApp = useNuxtApp()
  const config = useRuntimeConfig()

  // Routing mode from config
  const routingMode = computed(() => {
    return ((config.public?.croutonPages as any)?.routingMode as string) || 'team'
  })

  // Get domain context from SSR payload or event
  const domainContext = useState('crouton-domain-context', () => {
    // On server, try to get from event context
    if (import.meta.server) {
      const event = useRequestEvent()
      if (event) {
        return {
          isCustomDomain: event.context.isCustomDomain || false,
          routingMode: event.context.routingMode || routingMode.value,
          resolvedDomain: event.context.resolvedDomain || null,
          resolvedTeamId: event.context.resolvedDomainTeamId || null,
          resolvedTeamSlug: (event.context.resolvedDomainTeamSlug as string | null | undefined) || null,
          appSegments: (event.context.resolvedDomainAppSegments as string[] | undefined) || []
        }
      }
    }
    // Default state
    return {
      isCustomDomain: false,
      routingMode: routingMode.value,
      resolvedDomain: null,
      resolvedTeamId: null,
      resolvedTeamSlug: null as string | null,
      appSegments: [] as string[]
    }
  })

  // Computed properties for easy access
  const isCustomDomain = computed(() => domainContext.value.isCustomDomain)
  const isLocaleMode = computed(() => domainContext.value.routingMode === 'locale' || domainContext.value.routingMode === 'custom')
  const resolvedDomain = computed(() => domainContext.value.resolvedDomain)
  const resolvedTeamId = computed(() => domainContext.value.resolvedTeamId)
  const resolvedTeamSlug = computed<string | null>(() => domainContext.value.resolvedTeamSlug || null)
  const appSegments = computed<string[]>(() => domainContext.value.appSegments || [])

  // Check if we should hide team-specific UI elements
  const hideTeamInUrl = computed(() => {
    // On custom domains or locale-mode sites, the team is implicit
    return isCustomDomain.value || isLocaleMode.value
  })

  // Team mode, one-locale apps: public URLs carry no locale segment.
  const hideLocaleInUrl = computed(() =>
    routingMode.value === 'team' && !!(config.public?.croutonPages as any)?.hideLocaleInUrl
  )

  // A connected domain in team routing mode: the router keeps team-ful paths and
  // the team-host history (app/router.options.ts) hides the team in the address bar.
  const isTeamHost = computed(() => isCustomDomain.value && !!resolvedTeamSlug.value && !isLocaleMode.value)

  // Router links omit the team only in locale/custom mode (#4175). On a connected
  // domain (team mode) links keep the team and the history strips it from the href.
  const hideTeamInLinks = computed(() => isLocaleMode.value)

  // Get the current hostname
  const hostname = computed(() => {
    if (import.meta.server) {
      const event = useRequestEvent()
      if (event) {
        return getRequestHost(event, { xForwardedHost: true })?.split(':')[0] || null
      }
    }
    if (import.meta.client) {
      return window.location.hostname
    }
    return null
  })

  // Check if current hostname is a known app domain
  const isAppDomain = computed(() => {
    if (!hostname.value) return false
    const appDomains = (config.public?.croutonPages?.appDomains as string[] | undefined) || []
    return appDomains.some(d => hostname.value === d || hostname.value?.endsWith(`.${d}`))
  })

  return {
    /** Whether the current request is from a verified custom domain */
    isCustomDomain,
    /** Whether locale routing mode is active */
    isLocaleMode,
    /** The custom domain hostname (if any) */
    resolvedDomain,
    /** The team ID resolved from the custom domain */
    resolvedTeamId,
    /** Team slug resolved from the custom domain (null off a connected domain) */
    resolvedTeamSlug,
    /** The app's own top-level page addresses, left untouched on a connected domain */
    appSegments,
    /** Whether the team is implicit (custom domains or locale mode) — canonical URLs, team UI, not router links */
    hideTeamInUrl,
    /** Whether to omit the locale segment in public URLs (team mode + croutonPages.hideLocaleInUrl) */
    hideLocaleInUrl,
    /** True on a connected domain in team routing mode */
    isTeamHost,
    /** Whether router links omit the team (true only in locale/custom mode) */
    hideTeamInLinks,
    /** Current hostname */
    hostname,
    /** Whether current hostname is a known app domain */
    isAppDomain
  }
}
