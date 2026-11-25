/**
 * Page Link Composable
 *
 * Fetches the team's pages and resolves a page id to its canonical public URL
 * (locale- and team-aware, nested by ancestor slugs). Powers the block editor's
 * page picker (the page list) and the public renderer (resolve a stored page id
 * to a URL).
 *
 * Mirrors useNavigation's team/locale resolution but is purpose-built for "given
 * a page id, what's its URL" rather than building a nav tree.
 *
 * @example
 * const { pages, pageOptions, resolve } = usePageLink()
 * const href = resolve(button.pageId) // → "/acme/nl/events/summer-fair"
 */
import { buildPagePath, buildSlugPath, type MinimalPage } from '../utils/page-path'

export interface PageLinkItem {
  id: string
  title: string
  slug: string
  parentId?: string | null
}

export function usePageLink(teamSlug?: MaybeRef<string | null>) {
  const route = useRoute()
  const { locale: i18nLocale } = useT()
  const { teamId } = useTeamContext()
  const { hideTeamInLinks, hideLocaleInUrl } = useDomainContext()

  const runtimeConfig = useRuntimeConfig()
  const pagesConfig = runtimeConfig.public?.croutonPages as { defaultLocale?: string } | undefined
  const defaultTeamSlug = (runtimeConfig.public?.crouton as any)?.auth?.teams?.defaultTeamSlug as string | undefined

  // Supported locales + default from i18n, used to reject an unsupported live
  // locale (e.g. a stale i18n cookie) that would build an unreachable URL.
  let supportedLocales: string[] = []
  let i18nDefaultLocale = ''
  try {
    const i18n = useI18n()
    supportedLocales = (i18n.locales.value as Array<string | { code: string }>)
      .map(l => (typeof l === 'string' ? l : l.code))
    i18nDefaultLocale = (i18n.defaultLocale as string) || ''
  } catch {
    // i18n unavailable (rare SSR contexts) — fall back to config below.
  }

  const locale = computed(() => {
    const live = i18nLocale.value
    if (live && (!supportedLocales.length || supportedLocales.includes(live))) return live
    return (supportedLocales.length === 1 ? supportedLocales[0]! : '')
      || i18nDefaultLocale
      || pagesConfig?.defaultLocale
      || 'en'
  })

  const routeTeam = computed(() => {
    const param = route.params.team
    return typeof param === 'string' ? param : null
  })
  const team = computed(() => {
    const teamValue = toValue(teamSlug)
    if (teamValue) return teamValue
    return routeTeam.value || teamId.value || defaultTeamSlug || null
  })

  // Forward the auth cookie on SSR so admin/members pages resolve for a logged-in
  // user (same reason as useNavigation).
  const requestHeaders = import.meta.server ? useRequestHeaders(['cookie']) : undefined

  // Fetch published pages for the team (locale-resolved slugs). Same endpoint
  // useNavigation uses — shared cache key keeps this cheap.
  const { data: pages, pending: isLoading, refresh } = useFetch(() => {
    if (!team.value || RESERVED_PREFIXES.includes(team.value)) return null as any
    return `/api/teams/${team.value}/pages`
  }, {
    params: { locale },
    headers: requestHeaders,
    default: () => [],
    transform: (data: any) => data?.data || data || []
  })

  // Refresh when the pages collection is mutated.
  useMutationListener((event) => {
    if (event?.collection === 'pagesPages') refresh()
  })

  const pagesById = computed(() => {
    const map = new Map<string, MinimalPage>()
    for (const p of (pages.value as any[]) || []) {
      map.set(p.id, { id: p.id, slug: p.slug, parentId: p.parentId })
    }
    return map
  })

  /** Flat list for pickers. */
  const items = computed<PageLinkItem[]>(() =>
    ((pages.value as any[]) || []).map(p => ({
      id: p.id,
      title: p.title || p.slug || p.id,
      slug: p.slug,
      parentId: p.parentId
    }))
  )

  /** Select-menu options ({ label, value }). */
  const pageOptions = computed(() =>
    items.value.map(p => ({ label: p.title, value: p.id }))
  )

  /** Resolve a page id to its canonical public URL, or undefined if unknown. */
  const resolve = (pageId?: string | null): string | undefined => {
    if (!pageId) return undefined
    const page = pagesById.value.get(pageId)
    if (!page) return undefined
    return buildPagePath({
      hideTeamInUrl: hideTeamInLinks.value,
      hideLocaleInUrl: hideLocaleInUrl.value,
      team: team.value,
      locale: locale.value,
      slugPath: buildSlugPath(page, pagesById.value, locale.value)
    })
  }

  return {
    /** Raw fetched pages (published, visible to current user). */
    pages,
    /** Flat list of pages for pickers. */
    items,
    /** Select-menu options ({ label, value: pageId }). */
    pageOptions,
    /** Loading state. */
    isLoading,
    /** Resolve a page id → canonical public URL. */
    resolve,
    /** Refetch the page list. */
    refresh,
    /** Current locale used for slug resolution. */
    locale
  }
}
