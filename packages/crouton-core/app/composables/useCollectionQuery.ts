import type { Ref, ComputedRef } from 'vue'
import type { UseFetchOptions } from 'nuxt/app'
import type { CollectionTypeMap, CollectionItem, CollectionName } from '#crouton/types'

interface CollectionQueryOptions {
  query?: ComputedRef<Record<string, any>> | Ref<Record<string, any>>
  watch?: boolean
  /**
   * Opt-in server pagination. `true` uses a default page size of 10;
   * pass `{ pageSize }` to override. When enabled, `page`/`pageSize` are
   * folded into the request query and the server returns `{ items, total }`.
   */
  pagination?: boolean | { pageSize?: number }
}

/** Shape consumed by `<CroutonCollection :pagination-data>` / `CroutonTablePagination`. */
interface CollectionPaginationData {
  currentPage: number
  pageSize: number
  totalItems: number
  totalPages: number
}

interface CollectionQueryReturn<T> {
  items: ComputedRef<T[]>
  data: Ref<any>
  refresh: () => Promise<void>
  pending: Ref<boolean>
  error: Ref<any>
  /** Current page (1-based), writable. Inert unless `pagination` is enabled. */
  page: Ref<number>
  /** Rows per page, writable. Changing it resets to page 1. */
  pageSize: Ref<number>
  /** Total matching rows reported by the server (`{ total }`), array length otherwise. */
  total: ComputedRef<number>
  /** Number of pages (`ceil(total / pageSize)`, min 1). */
  pageCount: ComputedRef<number>
  /** Ready to bind to `<CroutonCollection :pagination-data>`; `null` when pagination is off. */
  paginationData: ComputedRef<CollectionPaginationData | null>
  /** Clamp + set the current page. */
  setPage: (p: number) => void
  nextPage: () => void
  prevPage: () => void
}

/**
 * Query-based data fetching for collections
 * Replaces the old global state pattern with Nuxt's built-in cache
 *
 * Features:
 * - Query-based cache keys (different queries = different cache entries)
 * - Automatic reactivity with watch
 * - Works with Nuxt's SSR/cache system
 * - Multiple views can coexist without conflicts
 * - Type-safe: Only registered collections are allowed
 *
 * @example
 * // Type-safe usage - type is automatically inferred
 * const { items, pending } = await useCollectionQuery('blogPosts')
 * // items is ComputedRef<BlogPost[]>
 *
 * @example
 * // With query parameters (pagination, filters)
 * const page = ref(1)
 * const { items, pending } = await useCollectionQuery('blogPosts', {
 *   query: computed(() => ({ page: page.value, status: 'active' }))
 * })
 *
 * @example
 * // With translations
 * const { locale } = useI18n()
 * const { items, pending } = await useCollectionQuery('blogPosts', {
 *   query: computed(() => ({ locale: locale.value }))
 * })
 */
export async function useCollectionQuery<K extends CollectionName>(collection: K, options?: CollectionQueryOptions): Promise<CollectionQueryReturn<CollectionItem<K>>>
export async function useCollectionQuery(collection: string, options?: CollectionQueryOptions): Promise<CollectionQueryReturn<any>>
export async function useCollectionQuery(
  collection: string,
  options: CollectionQueryOptions = {}
): Promise<CollectionQueryReturn<any>> {
  const route = useRoute()
  const collections = useCollections()
  const config = collections.getConfig(collection)
  const { getTeamId } = useTeamContext()

  if (!config) {
    console.error(`[useCollectionQuery] Collection "${collection}" not found in registry`)
    throw new Error(`Collection "${collection}" not registered`)
  }

  const apiPath = config.apiPath || collection

  // Pagination state (inert unless options.pagination is set)
  const paginationEnabled = !!options.pagination
  const defaultPageSize = (typeof options.pagination === 'object' && options.pagination?.pageSize) || 10
  const page = ref(1)
  const pageSize = ref(defaultPageSize)

  // Reset to the first page whenever the page size changes (pagination only)
  if (paginationEnabled) {
    watch(pageSize, () => { page.value = 1 })
  }

  // When pagination is enabled, fold page/pageSize into the outgoing query so a
  // single reactive source drives both the cache key and the fetch.
  const effectiveQuery = computed(() => ({
    ...(options.query?.value || {}),
    page: page.value,
    pageSize: pageSize.value
  }))
  const queryForFetch = paginationEnabled ? effectiveQuery : options.query

  // Generate cache key based on collection + query params
  const cacheKey = computed(() => {
    const queryStr = queryForFetch?.value
      ? JSON.stringify(queryForFetch.value)
      : '{}'
    return `collection:${collection}:${queryStr}`
  })

  // Determine the full API path based on route context
  const fullApiPath = computed(() => {
    if (route.path.includes('/super-admin/')) {
      return `/api/super-admin/${apiPath}`
    }

    const teamId = getTeamId()
    if (!teamId) {
      // Team context not yet available (SSR or before auth loads)
      // Return null to skip the fetch - client will retry when context is available
      return null
    }

    return `/api/teams/${teamId}/${apiPath}`
  })

  // Track if we should skip fetching (no team context yet)
  const shouldSkip = computed(() => fullApiPath.value === null)

  // Build watch array - watch query if provided, and also watch fullApiPath for team context changes
  const watchArray = queryForFetch && options.watch !== false
    ? [queryForFetch, fullApiPath]
    : [fullApiPath]

  // Local state for when we skip fetching
  const localData = ref<any>(null)
  const localPending = ref(false)
  const localError = ref<any>(null)

  // Forward the browser's auth cookie during SSR so team-scoped endpoints
  // see the user's better-auth session. On the client this is undefined.
  const requestHeaders = import.meta.server ? useRequestHeaders(['cookie']) : undefined

  // Re-fetch when a remote client changed this collection (fired by crouton-collab).
  // Registered before the await so the Nuxt context + effect scope are still active.
  let refreshOnRemote: (() => Promise<void>) | undefined
  const stopRemoteHook = useNuxtApp().hook('crouton:remoteChange' as any, (event: { collection: string }) => {
    if (event?.collection === collection) return refreshOnRemote?.()
  })
  if (getCurrentScope()) onScopeDispose(stopRemoteHook)

  // Use Nuxt's useFetch with proper caching
  // Skip fetching if no team context (will re-fetch when context becomes available)
  const fetchOptions: UseFetchOptions<any> = {
    key: cacheKey.value,
    query: queryForFetch,
    watch: watchArray,
    immediate: !shouldSkip.value,
    headers: requestHeaders
  }

  const { data, refresh: doRefresh, pending, error } = await useFetch(
    () => fullApiPath.value || '/api/__skip__',
    fetchOptions
  )

  // Custom refresh that checks team context
  const refresh = async () => {
    if (shouldSkip.value) {
      return // Can't refresh without team context
    }
    await doRefresh()
  }
  refreshOnRemote = refresh

  // Return normalized data structure
  // Handle both array responses and paginated responses
  const items = computed(() => {
    const val = data.value
    if (!val) {
      return []
    }

    let rawItems: any[] = []

    // Handle array response
    if (Array.isArray(val)) {
      rawItems = val
    }
    // Handle paginated response
    else if (val.items && Array.isArray(val.items)) {
      rawItems = val.items
    } else {
      return []
    }

    return rawItems
  })

  // Total matching rows: prefer the server's `{ total }`, fall back to array length
  const total = computed<number>(() => {
    const val = data.value
    if (val && typeof val === 'object' && !Array.isArray(val) && typeof val.total === 'number') {
      return val.total
    }
    return items.value.length
  })

  const pageCount = computed(() => Math.max(1, Math.ceil(total.value / (pageSize.value || 1))))

  const paginationData = computed<CollectionPaginationData | null>(() =>
    paginationEnabled
      ? {
          currentPage: page.value,
          pageSize: pageSize.value,
          totalItems: total.value,
          totalPages: pageCount.value
        }
      : null
  )

  function setPage(p: number) {
    page.value = Math.min(Math.max(1, Math.floor(p) || 1), pageCount.value)
  }
  function nextPage() { setPage(page.value + 1) }
  function prevPage() { setPage(page.value - 1) }

  return {
    items,
    data,
    refresh,
    pending,
    error,
    page,
    pageSize,
    total,
    pageCount,
    paginationData,
    setPage,
    nextPage,
    prevPage
  }
}
