/**
 * Navigation Composable
 *
 * Builds navigation from published pages in the pagesPages collection.
 * Supports hierarchical navigation with parent-child relationships.
 *
 * @example
 * ```vue
 * <script setup>
 * const { navigation, flatNavigation, isLoading } = useNavigation()
 * </script>
 *
 * <template>
 *   <nav v-if="!isLoading">
 *     <template v-for="item in navigation" :key="item.id">
 *       <NuxtLink :to="item.path">{{ item.title }}</NuxtLink>
 *       <template v-if="item.children?.length">
 *         <NuxtLink
 *           v-for="child in item.children"
 *           :key="child.id"
 *           :to="child.path"
 *         >
 *           {{ child.title }}
 *         </NuxtLink>
 *       </template>
 *     </template>
 *   </nav>
 * </template>
 * ```
 */
export interface NavigationItem {
  id: string
  title: string
  slug: string
  path: string
  icon?: string
  pageType: string
  depth: number
  order: number
  children?: NavigationItem[]
  /** True for virtual items generated from collection binder pages */
  isVirtual?: boolean
}

import { buildPagePath, buildSlugPath, type MinimalPage } from '../utils/page-path'

export function useNavigation(teamSlug?: MaybeRef<string | null>) {
  const route = useRoute()
  // Use the safe useT() wrapper rather than raw useI18n(): on public routes the
  // i18n auto-import can be unavailable (SSR), which throws "useI18n is not
  // defined". useT() catches that internally and still exposes a locale ref.
  const { locale: i18nLocale } = useT()
  const collections = useCollections()
  const { teamId } = useTeamContext()
  const { hideTeamInLinks, hideLocaleInUrl } = useDomainContext()

  // Detect public context: not in admin route
  const isPublicContext = computed(() => !route.path.includes('/admin/'))

  // Pages config
  const runtimeConfig = useRuntimeConfig()
  const pagesConfig = (runtimeConfig.public?.croutonPages as any) as { defaultLocale?: string } | undefined

  // Default team slug from auth config (for locale/custom routing modes without auth)
  const defaultTeamSlug = (runtimeConfig.public?.crouton as any)?.auth?.teams?.defaultTeamSlug as string | undefined

  // Locale with fallback — i18n locale may be empty during hydration
  const locale = computed(() => i18nLocale.value || pagesConfig?.defaultLocale || 'en')

  // Resolve team from prop, route, or domain context
  // Prefer route param (slug) over teamId for API calls — teamId may switch from slug
  // to UUID after auth loads during hydration, causing useFetch payload mismatch and
  // an empty navigation flash (or permanent loss when no setLocale retrigger occurs).
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

  // Forward the auth cookie on SSR so the endpoint can see the session and return
  // members/admin pages for a logged-in user. Without this the server-side fetch
  // is anonymous (public pages only), and the client reuses that payload — so an
  // admin's members/admin pages never reach the nav.
  const requestHeaders = import.meta.server ? useRequestHeaders(['cookie']) : undefined

  // Fetch published pages for the team with locale for translated titles/slugs
  const { data: pages, pending: isLoading, refresh } = useFetch(() => {
    if (!team.value || RESERVED_PREFIXES.includes(team.value)) return null as any
    return `/api/teams/${team.value}/pages`
  }, {
    params: { locale },
    headers: requestHeaders,
    default: () => [],
    transform: (data: any) => data?.data || data || []
  })

  // Map of pageId → collection items for collection binder pages
  const binderItemsMap = ref<Record<string, NavigationItem[]>>({})

  // Refresh navigation when pages collection is mutated (reorder, move, create, update, delete)
  useMutationListener((event) => {
    if (event?.collection === 'pagesPages') {
      refresh()
      binderItemsMap.value = {} // clear cached binder items on mutation
    }
  })

  // When pages load, fetch collection items for any binder pages
  watch(pages, async (newPages) => {
    if (!newPages || !team.value) return

    const binders = (newPages as any[]).filter((p: any) =>
      p.pageType === 'pages:collection-binder' &&
      p.config?.collection &&
      p.status === 'published' &&
      p.showInNavigation !== false
    )

    // Index all pages so a nested binder's URL includes its ancestor slugs.
    const binderPagesById = new Map<string, MinimalPage>()
    for (const p of newPages as any[]) {
      binderPagesById.set(p.id, { id: p.id, slug: p.slug, parentId: p.parentId })
    }

    await Promise.all(binders.map(async (binder: any) => {
      if (binderItemsMap.value[binder.id]) return // already loaded

      const colConfig = collections.getConfig(binder.config.collection)
      if (!colConfig?.apiPath) return

      const binderPath = buildPagePath({
        hideTeamInUrl: hideTeamInLinks.value,
        hideLocaleInUrl: hideLocaleInUrl.value,
        team: team.value,
        locale: locale.value,
        slugPath: buildSlugPath(binderPagesById.get(binder.id)!, binderPagesById, locale.value)
      })

      const titleField = colConfig.display?.title || 'title'

      try {
        // Use public endpoint when binder page visibility is public and we're on a public route
        const usePublicEndpoint = isPublicContext.value && binder.visibility === 'public'
        const fetchUrl = usePublicEndpoint
          ? `/api/public/${team.value}/${binder.config.collection}`
          : `/api/teams/${team.value}/${colConfig.apiPath}`
        const response = await $fetch<any>(fetchUrl)
        const rawItems: any[] = Array.isArray(response?.data) ? response.data
          : Array.isArray(response?.items) ? response.items
          : Array.isArray(response) ? response
          : []

        binderItemsMap.value[binder.id] = rawItems.map((item: any) => {
          // Resolve title with translation fallback
          const directTitle = item[titleField]
          const translatedTitle = item.translations?.[locale.value]?.[titleField]
            || item.translations?.en?.[titleField]
          const title = directTitle || translatedTitle || item.title || item.name || item.id

          return {
            id: `virtual-${binder.id}-${item.id}`,
            title: String(title),
            slug: item.id,
            path: `${binderPath}/${item.id}`,
            pageType: 'virtual-binder-item',
            depth: (binder.depth || 0) + 1,
            order: item.order ?? 0,
            isVirtual: true
          }
        })
      } catch {
        binderItemsMap.value[binder.id] = []
      }
    }))
  }, { immediate: true })

  // Build hierarchical navigation tree
  // eslint-disable-next-line vue/no-side-effects-in-computed-properties -- reading binderItemsMap is safe
  const navigation = computed<NavigationItem[]>(() => {
    if (!pages.value || !Array.isArray(pages.value)) return []

    // Filter to only published pages that should show in navigation.
    // Footer pages are excluded — they are rendered separately via useFooterPage().
    // Note: 'admin' visibility is NOT excluded here — the server only returns
    // admin pages to admins (see pages.get.ts), so when they reach the client
    // they're meant to appear in the front nav for that admin.
    const navPages = pages.value.filter((p: any) =>
      p.status === 'published' &&
      p.showInNavigation !== false &&
      p.visibility !== 'hidden' &&
      p.pageType !== 'pages:footer'
    )

    // Index ALL returned pages by id so a child's nested URL can include the
    // slugs of ancestors that are themselves hidden from navigation.
    const pagesById = new Map<string, MinimalPage>()
    for (const p of pages.value as any[]) {
      pagesById.set(p.id, { id: p.id, slug: p.slug, parentId: p.parentId })
    }

    // Convert to NavigationItem format — path is the nested slug chain
    // (/{team}/{locale}/{parent}/{child}), resolved via the shared helper.
    const items: NavigationItem[] = navPages.map((p: any) => ({
      id: p.id,
      title: p.title,
      slug: p.slug,
      path: buildPagePath({
        hideTeamInUrl: hideTeamInLinks.value,
        hideLocaleInUrl: hideLocaleInUrl.value,
        team: team.value,
        locale: locale.value,
        slugPath: buildSlugPath(pagesById.get(p.id)!, pagesById, locale.value)
      }),
      icon: p.icon,
      pageType: p.pageType,
      depth: p.depth || 0,
      order: p.order || 0,
      parentId: p.parentId
    }))

    // Build tree structure
    const rootItems: NavigationItem[] = []
    const itemMap = new Map<string, NavigationItem>()

    // First pass: create map
    items.forEach(item => {
      itemMap.set(item.id, { ...item, children: [] })
    })

    // Second pass: build tree
    // If a page has a parentId but that parent isn't in the nav set,
    // exclude the child (parent was hidden from navigation)
    items.forEach(item => {
      const current = itemMap.get(item.id)!
      const parentId = (item as any).parentId

      if (parentId && itemMap.has(parentId)) {
        const parent = itemMap.get(parentId)!
        if (!parent.children) parent.children = []
        parent.children.push(current)
      } else if (!parentId || !parentId.trim()) {
        rootItems.push(current)
      }
      // else: parentId is set but parent not in nav — exclude this child
    })

    // Inject virtual binder items as children of binder pages
    for (const [binderId, virtualChildren] of Object.entries(binderItemsMap.value)) {
      const binderItem = itemMap.get(binderId)
      if (!binderItem || virtualChildren.length === 0) continue

      // Add virtual children (they don't already exist in the page tree)
      if (!binderItem.children) binderItem.children = []
      // Only add if no real page-tree children with the same IDs exist
      for (const vChild of virtualChildren) {
        if (!binderItem.children.some(c => c.id === vChild.id)) {
          binderItem.children.push(vChild)
        }
      }
    }

    // Sort by order at each level
    const sortByOrder = (items: NavigationItem[]) => {
      items.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
      items.forEach(item => {
        if (item.children?.length) {
          sortByOrder(item.children)
        }
      })
    }
    sortByOrder(rootItems)

    return rootItems
  })

  // Flat navigation (no hierarchy, just a list)
  const flatNavigation = computed<NavigationItem[]>(() => {
    const flatten = (items: NavigationItem[]): NavigationItem[] => {
      return items.reduce((acc, item) => {
        acc.push(item)
        if (item.children?.length) {
          acc.push(...flatten(item.children))
        }
        return acc
      }, [] as NavigationItem[])
    }
    return flatten(navigation.value)
  })

  // Check if current route matches a navigation item
  const isActive = (item: NavigationItem) => {
    return route.path === item.path || route.path.startsWith(`${item.path}/`)
  }

  // Get current page from navigation
  const currentPage = computed(() => {
    return flatNavigation.value.find(item => isActive(item))
  })

  return {
    /** Hierarchical navigation tree */
    navigation,
    /** Flat list of all navigation items */
    flatNavigation,
    /** Whether navigation is loading */
    isLoading,
    /** Current active page */
    currentPage,
    /** Check if a navigation item is active */
    isActive,
    /** Refresh navigation data */
    refresh,
    /** Current team slug */
    team
  }
}
